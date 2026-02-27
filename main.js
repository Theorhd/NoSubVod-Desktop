const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const { startServer } = require('./server/app');
const ip = require('ip');
const QRCode = require('qrcode');

let mainWindow;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico') // Use the new icon.ico file
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Intercept close event to minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use the new icon.ico file for the tray
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show App', 
      click: () => {
        mainWindow.show();
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
    mainWindow.show();
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
    startServer(port);
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  // Send initial data to renderer
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const localIp = ip.address();
      const portalUrl = `http://${localIp}:${port}`;
      const qrCodeDataUrl = await QRCode.toDataURL(portalUrl);
      mainWindow.webContents.send('server-info', {
        ip: localIp,
        port: port,
        url: portalUrl,
        qrcode: qrCodeDataUrl
      });
    } catch (err) {
      console.error('Failed to generate QR code or get IP', err);
      // Send at least something so it doesn't stay on "Waiting..."
      mainWindow.webContents.send('server-info', {
        ip: 'Error',
        port: port,
        url: 'Failed to generate URL',
        qrcode: ''
      });
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Since we use the tray, we don't want to quit when all windows are closed 
// unless the user specifically clicks "Quit" in the tray.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
