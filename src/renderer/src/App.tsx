import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ServerInfo } from '../../shared/types';

export default function App() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    invoke<ServerInfo>('get_server_info')
      .then(setServerInfo)
      .catch((err) => {
        console.error('Failed to get server info:', err);
        // Fallback for browser-only development
        setServerInfo({
          ip: '127.0.0.1',
          port: 23455,
          url: 'http://127.0.0.1:23455',
          qrcode: '',
        });
      });
  }, []);

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.h1}>NoSubVod Portal</h1>
        <div style={styles.status}>Server is running</div>
        <p>Access the portal on your phone:</p>
        <div style={styles.urlBox}>{serverInfo ? serverInfo.url : 'Waiting...'}</div>
        {serverInfo?.qrcode && <img style={styles.qrcode} src={serverInfo.qrcode} alt="QR Code" />}
        <p style={styles.info}>
          Make sure your phone is connected to the same Wi-Fi network. Scan the QR code or type the
          address directly into Safari.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    textAlign: 'center',
    backgroundColor: '#18181b',
    color: '#efeff1',
    padding: '2rem',
    margin: 0,
    minHeight: '100vh',
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: '500px',
    margin: '0 auto',
    backgroundColor: '#0e0e10',
    padding: '2rem',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  h1: {
    color: '#a970ff',
    fontSize: '1.5rem',
    marginTop: 0,
  },
  status: {
    fontWeight: 'bold',
    color: '#2ecc71',
    marginBottom: '1rem',
  },
  urlBox: {
    backgroundColor: '#1f1f23',
    border: '1px solid #3a3a3d',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '1.2rem',
    marginBottom: '1.5rem',
    userSelect: 'all',
  },
  qrcode: {
    backgroundColor: 'white',
    padding: '10px',
    borderRadius: '4px',
    width: '250px',
    height: '250px',
    objectFit: 'contain',
    marginTop: '1rem',
    display: 'inline-block',
  },
  info: {
    color: '#adadb8',
    fontSize: '0.9rem',
    marginTop: '2rem',
  },
};
