import { app, BrowserWindow, Tray, Menu } from 'electron';
import path from 'node:path';
import { startServer } from '../server/index';
import ip from 'ip';
import QRCode from 'qrcode';
import { ServerInfo } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = process.argv.includes('--dev');
const RENDERER_DEV_SERVER_URL = 'http://localhost:5174'; // Vite default is 5173, but we might have 2 vite servers running (portal and renderer). Let's define it.

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../icon.ico') // icon at root in production, or relative to dist
  });

  if (isDev) {
    mainWindow.loadURL(RENDERER_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  }

  // Intercept close event to minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting && mainWindow) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, isDev ? '../../icon.ico' : '../icon.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show App', 
      click: () => {
        if (mainWindow) mainWindow.show();
      } 
    },
    { type: 'separator' },
    { 
      label: 'Quit NoSubVOD', 
      click: () => {
        isQuitting = true;
        app.quit();
      } 
    }
  ]);

  tray.setToolTip('NoSubVOD Server');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });
}

app.whenReady().then(() => {
  try {
    createWindow();
  } catch (err) {
    console.error('Failed to create window:', err);
  }

  try {
    createTray();
  } catch (err) {
    console.error('Failed to create tray (might be missing icon):', err);
  }

  // Start the Express Server
  const port = 23455;
  try {
    startServer(port, isDev, app.getPath('userData'));
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  // Send initial data to renderer
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        const localIp = ip.address();
        const portalUrl = isDev ? `http://${localIp}:5173` : `http://${localIp}:${port}`;
        const qrCodeDataUrl = await QRCode.toDataURL(portalUrl);
        const serverInfo: ServerInfo = {
          ip: localIp,
          port: port,
          url: portalUrl,
          qrcode: qrCodeDataUrl
        };
        mainWindow?.webContents.send('server-info', serverInfo);
      } catch (err) {
        console.error('Failed to generate QR code or get IP', err);
        const serverInfo: ServerInfo = {
          ip: 'Error',
          port: port,
          url: 'Failed to generate URL',
          qrcode: ''
        };
        mainWindow?.webContents.send('server-info', serverInfo);
      }
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});