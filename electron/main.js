const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const os = require('os');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const mqtt = require('mqtt');

let mainWindow = null;
let directServer = null;
let directClientSocket = null;
let directActiveConnection = null;
let signalMqttClient = null;
let currentSignalRoom = null;

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#0a0d14',
    title: 'Messroom P2P',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  }

  mainWindow.on('closed', () => {
    cleanupDirectSockets();
    cleanupSignalMqtt();
    mainWindow = null;
  });
}

function cleanupDirectSockets() {
  if (directClientSocket) {
    try { directClientSocket.close(); } catch (e) {}
    directClientSocket = null;
  }
  if (directActiveConnection) {
    try { directActiveConnection.close(); } catch (e) {}
    directActiveConnection = null;
  }
  if (directServer) {
    try { directServer.close(); } catch (e) {}
    directServer = null;
  }
}

function cleanupSignalMqtt() {
  if (signalMqttClient) {
    try {
      signalMqttClient.end(true);
    } catch (e) {}
    signalMqttClient = null;
  }
  currentSignalRoom = null;
}

// Network Interfaces & Public IP
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ iface: name, address: iface.address });
      }
    }
  }
  return ips;
}

function fetchPublicIP() {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ip || null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// IPC Handlers
ipcMain.handle('get-network-info', async () => {
  const localIps = getLocalIPs();
  const publicIp = await fetchPublicIP();
  return {
    localIps,
    publicIp,
    hostname: os.hostname(),
    platform: process.platform,
    defaultPort: 48800
  };
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'Messroom',
      body: body || '',
      icon: path.join(__dirname, '../assets/icon.png')
    }).show();
  }
  return true;
});

ipcMain.handle('select-avatar-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Profile Picture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp', 'gif'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1) || 'png';
  const base64 = `data:image/${ext};base64,${fileBuffer.toString('base64')}`;
  return base64;
});

ipcMain.handle('save-file', async (event, { defaultName, buffer }) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save File from Messroom',
    defaultPath: defaultName || 'downloaded-file'
  });

  if (result.canceled || !result.filePath) {
    return false;
  }

  try {
    const rawBuffer = Buffer.from(buffer);
    fs.writeFileSync(result.filePath, rawBuffer);
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Ephemeral P2P Signaling Broker (WebRTC Handshake)
ipcMain.handle('join-signal-room', async (event, { roomCode, peerId }) => {
  cleanupSignalMqtt();
  currentSignalRoom = roomCode;

  const brokerUrls = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  return new Promise((resolve) => {
    let resolved = false;

    function tryConnect(brokerIndex) {
      if (brokerIndex >= brokerUrls.length) {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: 'Signaling brokers unavailable' });
        }
        return;
      }

      const brokerUrl = brokerUrls[brokerIndex];
      const client = mqtt.connect(brokerUrl, {
        connectTimeout: 5000,
        reconnectPeriod: 0,
        clientId: 'mess_' + Math.random().toString(36).substring(2, 9)
      });

      signalMqttClient = client;

      client.on('connect', () => {
        const topic = `messroom/v1/${roomCode}/#`;
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            client.end(true);
            tryConnect(brokerIndex + 1);
            return;
          }
          if (!resolved) {
            resolved = true;
            if (mainWindow) {
              mainWindow.webContents.send('signal-status', { status: 'joined', roomCode, brokerUrl });
            }
            resolve({ success: true, brokerUrl });
          }
        });
      });

      client.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          // Ignore own messages
          if (data.fromPeerId !== peerId && mainWindow) {
            mainWindow.webContents.send('signal-message', data);
          }
        } catch (e) {
          console.error('Signal parse error', e);
        }
      });

      client.on('error', () => {
        client.end(true);
        if (!resolved) {
          tryConnect(brokerIndex + 1);
        }
      });
    }

    tryConnect(0);
  });
});

ipcMain.handle('send-signal-message', (event, { roomCode, fromPeerId, payload }) => {
  if (signalMqttClient && signalMqttClient.connected) {
    const topic = `messroom/v1/${roomCode}/exchange`;
    const message = JSON.stringify({
      fromPeerId,
      roomCode,
      timestamp: Date.now(),
      payload
    });
    signalMqttClient.publish(topic, message, { qos: 0 });
    return { success: true };
  }
  return { success: false, error: 'Signaling client not connected' };
});

ipcMain.handle('leave-signal-room', () => {
  cleanupSignalMqtt();
  return { success: true };
});

// Direct WebSocket Server (Hosting Direct P2P)
ipcMain.handle('start-direct-server', async (event, { port }) => {
  cleanupDirectSockets();
  const listenPort = port || 48800;

  return new Promise((resolve) => {
    try {
      directServer = new WebSocket.Server({ port: listenPort });

      directServer.on('listening', () => {
        resolve({ success: true, port: listenPort });
      });

      directServer.on('connection', (ws, req) => {
        const remoteIp = req.socket.remoteAddress;
        directActiveConnection = ws;

        if (mainWindow) {
          mainWindow.webContents.send('direct-socket-state', {
            type: 'connected',
            role: 'host',
            remoteIp,
            port: listenPort
          });
        }

        ws.on('message', (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('direct-socket-message', data.toString());
          }
        });

        ws.on('close', () => {
          directActiveConnection = null;
          if (mainWindow) {
            mainWindow.webContents.send('direct-socket-state', { type: 'disconnected' });
          }
        });

        ws.on('error', (err) => {
          if (mainWindow) {
            mainWindow.webContents.send('direct-socket-state', { type: 'error', error: err.message });
          }
        });
      });

      directServer.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

ipcMain.handle('stop-direct-server', () => {
  cleanupDirectSockets();
  return { success: true };
});

// Direct WebSocket Client (Connecting directly to Host IP:Port)
ipcMain.handle('connect-direct-socket', (event, { host, port }) => {
  cleanupDirectSockets();
  const targetUrl = `ws://${host}:${port || 48800}`;

  return new Promise((resolve) => {
    try {
      directClientSocket = new WebSocket(targetUrl);

      directClientSocket.on('open', () => {
        if (mainWindow) {
          mainWindow.webContents.send('direct-socket-state', {
            type: 'connected',
            role: 'client',
            remoteIp: host,
            port: port || 48800
          });
        }
        resolve({ success: true });
      });

      directClientSocket.on('message', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('direct-socket-message', data.toString());
        }
      });

      directClientSocket.on('close', () => {
        if (mainWindow) {
          mainWindow.webContents.send('direct-socket-state', { type: 'disconnected' });
        }
      });

      directClientSocket.on('error', (err) => {
        if (mainWindow) {
          mainWindow.webContents.send('direct-socket-state', { type: 'error', error: err.message });
        }
        resolve({ success: false, error: err.message });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

ipcMain.handle('send-direct-socket', (event, { message }) => {
  const target = directActiveConnection || directClientSocket;
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(message);
    return { success: true };
  }
  return { success: false, error: 'Not connected' };
});

ipcMain.handle('disconnect-direct-socket', () => {
  cleanupDirectSockets();
  return { success: true };
});

// Window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanupDirectSockets();
  cleanupSignalMqtt();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
