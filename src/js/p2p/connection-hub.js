/**
 * Unified P2P Connection Hub for Messroom
 * Bridges WebRTC DataChannels and Direct Socket connections into a single interface.
 */

import { WebRTCManager } from './webrtc-manager.js';
import { soundManager } from '../audio/sounds.js';
import { accountManager } from '../profile/account-manager.js';

export class ConnectionHub {
  constructor() {
    this.webrtc = new WebRTCManager();
    this.mode = 'idle'; // 'idle' | 'connecting' | 'connected'
    this.method = null; // 'room' | 'direct' | 'ticket'

    this.peerProfile = null;
    this.peerNetwork = null;
    this.roomCode = null;
    this.isHost = false;

    // Direct Socket State
    this.directRole = null;
    this.directRemoteIp = null;
    this.directPort = null;

    // Event listeners
    this.listeners = {
      state: [],
      chat: [],
      reaction: [],
      typing: [],
      profile: [],
      fileProgress: [],
      fileComplete: [],
      diagnostics: []
    };

    this.setupWebRTCListeners();
    this.setupDirectSocketListeners();
  }

  setupWebRTCListeners() {
    this.webrtc.onStateChange = (state) => {
      if (state === 'data-channel-open') {
        this.mode = 'connected';
        soundManager.playConnected();
        this.emit('state', { status: 'connected', method: this.method, isHost: this.isHost });

        // Detach ephemeral signaling immediately!
        if (window.messroomAPI && window.messroomAPI.leaveSignalRoom) {
          window.messroomAPI.leaveSignalRoom();
        }

        // Exchange profile immediately upon connection
        this.syncProfile();
      } else if (state === 'data-channel-closed' || state === 'disconnected' || state === 'failed') {
        if (this.mode === 'connected') {
          soundManager.playDisconnected();
        }
        this.mode = 'idle';
        this.peerProfile = null;
        this.emit('state', { status: 'disconnected', reason: state });
      }
    };

    this.webrtc.onMessageReceived = (msg) => {
      this.handleIncomingProtocolMessage(msg);
    };

    this.webrtc.onFileTransferProgress = (prog) => {
      this.emit('fileProgress', prog);
    };

    this.webrtc.onFileTransferComplete = (fileData) => {
      soundManager.playReceived();
      this.emit('fileComplete', fileData);
    };

    this.webrtc.onSignalData = (signalData) => {
      if (this.method === 'room' && this.roomCode && window.messroomAPI) {
        window.messroomAPI.sendSignalMessage(this.roomCode, this.webrtc.localPeerId, signalData);
      }
    };
  }

  setupDirectSocketListeners() {
    if (!window.messroomAPI) return;

    window.messroomAPI.onDirectSocketState((state) => {
      if (state.type === 'connected') {
        this.mode = 'connected';
        this.method = 'direct';
        this.directRole = state.role;
        this.directRemoteIp = state.remoteIp;
        this.directPort = state.port;
        soundManager.playConnected();
        this.emit('state', { status: 'connected', method: 'direct', isHost: state.role === 'host' });
        this.syncProfile();
      } else if (state.type === 'disconnected') {
        if (this.mode === 'connected') {
          soundManager.playDisconnected();
        }
        this.mode = 'idle';
        this.peerProfile = null;
        this.emit('state', { status: 'disconnected' });
      }
    });

    window.messroomAPI.onDirectSocketMessage((rawStr) => {
      try {
        const msg = JSON.parse(rawStr);
        this.handleIncomingProtocolMessage(msg);
      } catch (e) {
        console.error('Failed to parse direct socket message', e);
      }
    });
  }

  // --- Connection Methods ---

  async connectViaRoom(roomCode, isInitiator = false) {
    this.disconnect();
    this.mode = 'connecting';
    this.method = 'room';
    this.roomCode = roomCode.trim().toUpperCase();
    this.isHost = isInitiator;
    this.emit('state', { status: 'connecting', method: 'room', roomCode: this.roomCode });

    if (!window.messroomAPI) {
      throw new Error('Messroom native API not available');
    }

    // Join ephemeral signaling topic
    const joinRes = await window.messroomAPI.joinSignalRoom(this.roomCode, this.webrtc.localPeerId);
    if (!joinRes.success) {
      this.mode = 'idle';
      this.emit('state', { status: 'error', error: joinRes.error });
      return false;
    }

    // Listen for peer signals
    this.unsubSignal = window.messroomAPI.onSignalMessage(async (data) => {
      if (!data || !data.payload) return;
      const { payload } = data;

      if (payload.type === 'offer') {
        const answer = await this.webrtc.handleOffer(payload.sdp);
        window.messroomAPI.sendSignalMessage(this.roomCode, this.webrtc.localPeerId, {
          type: 'answer',
          sdp: answer
        });
      } else if (payload.type === 'answer') {
        await this.webrtc.handleAnswer(payload.sdp);
      } else if (payload.type === 'candidate') {
        await this.webrtc.addIceCandidate(payload.candidate);
      } else if (payload.type === 'peer-ready' && this.isHost) {
        // Friend joined! Send offer
        const offer = await this.webrtc.createOffer();
        window.messroomAPI.sendSignalMessage(this.roomCode, this.webrtc.localPeerId, {
          type: 'offer',
          sdp: offer
        });
      }
    });

    if (this.isHost) {
      // Create initial offer
      const offer = await this.webrtc.createOffer();
      window.messroomAPI.sendSignalMessage(this.roomCode, this.webrtc.localPeerId, {
        type: 'offer',
        sdp: offer
      });
    } else {
      // Notify host that we are ready
      window.messroomAPI.sendSignalMessage(this.roomCode, this.webrtc.localPeerId, {
        type: 'peer-ready'
      });
    }

    return true;
  }

  async startDirectServer(port = 48800) {
    this.disconnect();
    this.mode = 'connecting';
    this.method = 'direct';
    this.isHost = true;
    this.emit('state', { status: 'hosting-socket', port });

    if (!window.messroomAPI) return false;
    const res = await window.messroomAPI.startDirectServer(port);
    if (!res.success) {
      this.mode = 'idle';
      this.emit('state', { status: 'error', error: res.error });
      return false;
    }
    return true;
  }

  async connectDirectSocket(host, port = 48800) {
    this.disconnect();
    this.mode = 'connecting';
    this.method = 'direct';
    this.isHost = false;
    this.emit('state', { status: 'connecting', method: 'direct', host, port });

    if (!window.messroomAPI) return false;
    const res = await window.messroomAPI.connectDirectSocket(host, port);
    if (!res.success) {
      this.mode = 'idle';
      this.emit('state', { status: 'error', error: res.error });
      return false;
    }
    return true;
  }

  // --- Manual Ticket Support (Air-gapped) ---

  async createManualTicket() {
    this.disconnect();
    this.method = 'ticket';
    this.isHost = true;

    const offer = await this.webrtc.createOffer();
    // Wait brief moment for initial STUN candidates
    await new Promise(r => setTimeout(r, 600));

    const payload = {
      type: 'messroom_ticket_offer',
      sdp: this.webrtc.pc.localDescription
    };

    return btoa(JSON.stringify(payload));
  }

  async acceptManualTicket(ticketBase64) {
    this.disconnect();
    this.method = 'ticket';
    this.isHost = false;

    const json = JSON.parse(atob(ticketBase64));
    if (json.type !== 'messroom_ticket_offer') {
      throw new Error('Invalid Messroom Ticket Offer');
    }

    const answer = await this.webrtc.handleOffer(json.sdp);
    await new Promise(r => setTimeout(r, 600));

    const responsePayload = {
      type: 'messroom_ticket_answer',
      sdp: this.webrtc.pc.localDescription
    };

    return btoa(JSON.stringify(responsePayload));
  }

  async applyManualAnswer(ticketBase64) {
    const json = JSON.parse(atob(ticketBase64));
    if (json.type !== 'messroom_ticket_answer') {
      throw new Error('Invalid Messroom Ticket Answer');
    }
    await this.webrtc.handleAnswer(json.sdp);
    return true;
  }

  disconnect() {
    if (this.unsubSignal) {
      this.unsubSignal();
      this.unsubSignal = null;
    }
    if (window.messroomAPI) {
      window.messroomAPI.leaveSignalRoom();
      window.messroomAPI.stopDirectServer();
      window.messroomAPI.disconnectDirectSocket();
    }
    this.webrtc.cleanup();
    this.mode = 'idle';
    this.method = null;
    this.roomCode = null;
    this.peerProfile = null;
  }

  // --- Messaging & Payloads ---

  sendRawPayload(payload) {
    if (this.method === 'direct' && window.messroomAPI) {
      window.messroomAPI.sendDirectSocket(JSON.stringify(payload));
      return true;
    } else {
      return this.webrtc.sendPayload(payload);
    }
  }

  sendChat(text) {
    if (this.mode !== 'connected' || !text.trim()) return null;

    const msg = {
      type: 'CHAT_MESSAGE',
      id: 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      text: text.trim(),
      timestamp: Date.now(),
      sender: accountManager.getActive() ? accountManager.getActive().name : 'Me'
    };

    const sent = this.sendRawPayload(msg);
    if (sent) {
      soundManager.playSent();
      return msg;
    }
    return null;
  }

  sendReaction(messageId, emoji) {
    if (this.mode !== 'connected') return;
    const payload = {
      type: 'MESSAGE_REACTION',
      messageId,
      emoji,
      from: accountManager.getActive() ? accountManager.getActive().name : 'Me',
      timestamp: Date.now()
    };
    this.sendRawPayload(payload);
    soundManager.playReaction();
  }

  sendTyping(isTyping) {
    if (this.mode !== 'connected') return;
    this.sendRawPayload({
      type: 'TYPING_STATUS',
      isTyping: !!isTyping,
      from: accountManager.getActive() ? accountManager.getActive().name : 'Peer'
    });
  }

  syncProfile() {
    const pub = accountManager.getPublicProfile();
    if (!pub) return;
    this.sendRawPayload({
      type: 'PROFILE_SYNC',
      profile: pub
    });
  }

  async sendFile(file, progressCb) {
    if (this.mode !== 'connected') {
      throw new Error('Not connected');
    }
    return await this.webrtc.sendFile(file, progressCb);
  }

  handleIncomingProtocolMessage(msg) {
    switch (msg.type) {
      case 'CHAT_MESSAGE':
        soundManager.playReceived();
        if (window.messroomAPI && document.hidden) {
          window.messroomAPI.showNotification(`Messroom: ${msg.sender}`, msg.text);
        }
        this.emit('chat', msg);
        break;

      case 'MESSAGE_REACTION':
        soundManager.playReaction();
        this.emit('reaction', msg);
        break;

      case 'TYPING_STATUS':
        this.emit('typing', msg);
        break;

      case 'PROFILE_SYNC':
        this.peerProfile = msg.profile;
        this.emit('profile', msg.profile);
        break;
    }
  }

  getDiagnostics() {
    if (this.method === 'direct') {
      return {
        connected: this.mode === 'connected',
        method: 'direct-socket',
        role: this.directRole,
        remoteIp: this.directRemoteIp,
        port: this.directPort,
        latencyMs: 1
      };
    }
    const diag = this.webrtc.getDiagnostics();
    diag.method = this.method;
    diag.roomCode = this.roomCode;
    diag.isHost = this.isHost;
    return diag;
  }

  // Event Subscription
  on(event, cb) {
    if (this.listeners[event]) {
      this.listeners[event].push(cb);
    }
    return () => {
      this.listeners[event] = this.listeners[event].filter(x => x !== cb);
    };
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }
}

export const connectionHub = new ConnectionHub();
