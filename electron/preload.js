const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('messroomAPI', {
  platform: process.platform,

  // Network & System info
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  saveFile: (defaultName, buffer) => ipcRenderer.invoke('save-file', { defaultName, buffer }),
  selectAvatarFile: () => ipcRenderer.invoke('select-avatar-file'),

  // Ephemeral P2P Signaling (for WebRTC Handshake)
  joinSignalRoom: (roomCode, peerId) => ipcRenderer.invoke('join-signal-room', { roomCode, peerId }),
  sendSignalMessage: (roomCode, fromPeerId, payload) => ipcRenderer.invoke('send-signal-message', { roomCode, fromPeerId, payload }),
  leaveSignalRoom: () => ipcRenderer.invoke('leave-signal-room'),
  onSignalMessage: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('signal-message', handler);
    return () => ipcRenderer.removeListener('signal-message', handler);
  },
  onSignalStatus: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('signal-status', handler);
    return () => ipcRenderer.removeListener('signal-status', handler);
  },

  // Direct WebSocket P2P Server / Client
  startDirectServer: (port) => ipcRenderer.invoke('start-direct-server', { port }),
  stopDirectServer: () => ipcRenderer.invoke('stop-direct-server'),
  sendDirectSocket: (message) => ipcRenderer.invoke('send-direct-socket', { message }),
  connectDirectSocket: (host, port) => ipcRenderer.invoke('connect-direct-socket', { host, port }),
  disconnectDirectSocket: () => ipcRenderer.invoke('disconnect-direct-socket'),

  // Direct Socket Event Listeners
  onDirectSocketMessage: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('direct-socket-message', handler);
    return () => ipcRenderer.removeListener('direct-socket-message', handler);
  },
  onDirectSocketState: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('direct-socket-state', handler);
    return () => ipcRenderer.removeListener('direct-socket-state', handler);
  },

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close')
});
