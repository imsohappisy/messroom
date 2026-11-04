/**
 * Messroom Application Bootstrap & Coordinator
 */

import { accountManager } from './profile/account-manager.js';
import { connectionHub } from './p2p/connection-hub.js';
import { soundManager } from './audio/sounds.js';
import { ChatView } from './ui/chat-view.js';
import { ModalManager } from './ui/modals.js';

class MessroomApp {
  constructor() {
    this.chatView = null;
    this.modals = null;
    this.typingTimeout = null;
    this.isTypingSent = false;
  }

  async init() {
    this.initPlatformStyle();
    this.initSound();

    // Initialize UI Views
    const chatContainer = document.getElementById('chat-messages');
    const emptyState = document.getElementById('chat-empty-state');
    this.chatView = new ChatView(chatContainer, emptyState);
    this.modals = new ModalManager();

    this.initProfileUI();
    this.initWindowControls();
    this.initChatInput();
    this.initDragAndDrop();
    this.initConnectionActions();
    this.initConnectionHubEvents();
    this.startPeriodicStatsPoller();

    console.log('Messroom P2P app initialized successfully');
  }

  initPlatformStyle() {
    const isMac = (window.messroomAPI && window.messroomAPI.platform === 'darwin') || navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (isMac) {
      document.body.classList.add('platform-darwin');
      document.body.classList.remove('platform-win32');
    } else {
      document.body.classList.add('platform-win32');
      document.body.classList.remove('platform-darwin');
    }
  }

  initSound() {
    const soundBtn = document.getElementById('btn-header-sound');
    const soundIcon = document.getElementById('sound-icon');
    let soundOn = true;

    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        soundOn = !soundOn;
        soundManager.setEnabled(soundOn);
        if (soundIcon) soundIcon.textContent = soundOn ? 'volume_up' : 'volume_off';
      });
    }
  }

  initProfileUI() {
    const updateMyCard = (user) => {
      if (!user) return;
      const avatarBox = document.getElementById('my-avatar-box');
      const nameEl = document.getElementById('my-profile-name');
      const bioEl = document.getElementById('my-profile-bio');

      if (avatarBox) {
        avatarBox.textContent = (user.name || '사').charAt(0).toUpperCase();
        if (user.color) avatarBox.style.backgroundColor = user.color;
      }
      if (nameEl) nameEl.textContent = user.name;
      if (bioEl) bioEl.textContent = user.bio;
    };

    accountManager.subscribe(updateMyCard);
    updateMyCard(accountManager.getActive());

    // Click profile card to open modal
    const profileCard = document.getElementById('my-profile-card');
    const profileHeaderBtn = document.getElementById('btn-header-profile');

    const openProfile = () => this.modals.openModal('modal-profile');
    if (profileCard) profileCard.addEventListener('click', openProfile);
    if (profileHeaderBtn) profileHeaderBtn.addEventListener('click', openProfile);
  }

  initWindowControls() {
    if (!window.messroomAPI) return;

    const minBtn = document.getElementById('win-btn-minimize');
    const maxBtn = document.getElementById('win-btn-maximize');
    const closeBtn = document.getElementById('win-btn-close');

    if (minBtn) minBtn.addEventListener('click', () => window.messroomAPI.minimizeWindow());
    if (maxBtn) maxBtn.addEventListener('click', () => window.messroomAPI.maximizeWindow());
    if (closeBtn) closeBtn.addEventListener('click', () => window.messroomAPI.closeWindow());
  }

  initChatInput() {
    const textarea = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send-message');
    const attachBtn = document.getElementById('btn-attach-file');
    const fileInput = document.getElementById('file-picker-input');
    const emojiBtn = document.getElementById('btn-quick-emoji');

    const doSend = () => {
      const text = textarea.value.trim();
      if (!text) return;

      const sentMsg = connectionHub.sendChat(text);
      if (sentMsg) {
        this.chatView.addMessage(sentMsg, true);
        textarea.value = '';
        textarea.style.height = 'auto';
        connectionHub.sendTyping(false);
        this.isTypingSent = false;
      }
    };

    if (sendBtn) sendBtn.addEventListener('click', doSend);

    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doSend();
        } else {
          // Trigger typing indicator
          if (!this.isTypingSent) {
            connectionHub.sendTyping(true);
            this.isTypingSent = true;
          }
          if (this.typingTimeout) clearTimeout(this.typingTimeout);
          this.typingTimeout = setTimeout(() => {
            connectionHub.sendTyping(false);
            this.isTypingSent = false;
          }, 1800);
        }
      });

      // Auto resize textarea
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      });
    }

    // Attach file button
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        if (fileInput.files.length > 0) {
          const file = fileInput.files[0];
          await this.sendFile(file);
          fileInput.value = '';
        }
      });
    }
  }

  initDragAndDrop() {

    // Export chat button
    const exportBtn = document.getElementById('btn-export-chat');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const text = this.chatView.exportText();
        const encoder = new TextEncoder();
        const buffer = encoder.encode(text);
        if (window.messroomAPI && window.messroomAPI.saveFile) {
          await window.messroomAPI.saveFile('messroom-chat.txt', buffer);
        } else {
          const blob = new Blob([text], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'messroom-chat.txt';
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  initDragAndDrop() {
    const overlay = document.getElementById('drag-overlay');
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (overlay) overlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0 && overlay) {
        overlay.classList.remove('active');
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (overlay) overlay.classList.remove('active');

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        await this.sendFile(file);
      }
    });
  }

  async sendFile(file) {
    if (connectionHub.mode !== 'connected') {
      alert('Please connect to a peer first before sending files.');
      return;
    }

    try {
      this.chatView.renderFileTransfer({
        fileId: 'pending_' + Date.now(),
        fileName: file.name,
        fileSize: file.size,
        percent: 0,
        speedBytesPerSec: 0,
        isIncoming: false
      });

      const res = await connectionHub.sendFile(file, (prog) => {
        this.chatView.renderFileTransfer(prog);
      });

      this.chatView.completeFileTransfer({
        fileId: res.fileId,
        fileName: res.fileName,
        fileSize: res.fileSize,
        fileType: res.fileType,
        blob: file,
        isIncoming: false
      });
    } catch (err) {
      console.error('File send error', err);
      alert('Failed to send file: ' + err.message);
    }
  }

  initConnectionActions() {
    // Open Connect Modal
    const openRoomModal = document.getElementById('btn-open-room-modal');
    const openDirectModal = document.getElementById('btn-open-direct-modal');
    const openTicketModal = document.getElementById('btn-open-ticket-modal');
    const quickConnectBtn = document.getElementById('btn-sidebar-quick-connect');

    const openConnectModal = (tabId) => {
      this.modals.openModal('modal-connect');
      const tabBtn = document.querySelector(`[data-tab="${tabId}"]`);
      if (tabBtn) tabBtn.click();
    };

    if (openRoomModal) openRoomModal.addEventListener('click', () => openConnectModal('tab-room'));
    if (openDirectModal) openDirectModal.addEventListener('click', () => openConnectModal('tab-direct'));
    if (openTicketModal) openTicketModal.addEventListener('click', () => openConnectModal('tab-ticket'));
    if (quickConnectBtn) quickConnectBtn.addEventListener('click', () => openConnectModal('tab-room'));

    // Quick buttons in empty state
    const quickCreate = document.getElementById('btn-quick-create-room');
    const quickJoin = document.getElementById('btn-quick-join-room');
    const quickDirect = document.getElementById('btn-quick-direct-ip');

    if (quickCreate) quickCreate.addEventListener('click', () => openConnectModal('tab-room'));
    if (quickJoin) quickJoin.addEventListener('click', () => openConnectModal('tab-room'));
    if (quickDirect) quickDirect.addEventListener('click', () => openConnectModal('tab-direct'));

    // Network Diagnostics HUD triggers
    const hudBtn = document.getElementById('btn-network-diag');
    const statusPill = document.getElementById('header-status-pill');
    const chatHudBtn = document.getElementById('btn-chat-network');

    const openHud = () => this.modals.openModal('modal-network');
    if (hudBtn) hudBtn.addEventListener('click', openHud);
    if (statusPill) statusPill.addEventListener('click', openHud);
    if (chatHudBtn) chatHudBtn.addEventListener('click', openHud);

    // Random Room Code button
    const randCodeBtn = document.getElementById('btn-gen-room-code');
    const roomInput = document.getElementById('input-room-code');
    if (randCodeBtn && roomInput) {
      randCodeBtn.addEventListener('click', () => {
        const randNum = Math.floor(1000 + Math.random() * 9000);
        roomInput.value = `MESS-${randNum}`;
      });
    }

    // Room Actions: Create / Join
    const btnCreateRoom = document.getElementById('btn-action-create-room');
    const btnJoinRoom = document.getElementById('btn-action-join-room');

    if (btnCreateRoom) {
      btnCreateRoom.addEventListener('click', async () => {
        let code = roomInput.value.trim().toUpperCase();
        if (!code) {
          const randNum = Math.floor(1000 + Math.random() * 9000);
          code = `MESS-${randNum}`;
          roomInput.value = code;
        }
        await connectionHub.connectViaRoom(code, true);
        this.modals.closeModal('modal-connect');
      });
    }

    if (btnJoinRoom) {
      btnJoinRoom.addEventListener('click', async () => {
        const code = roomInput.value.trim().toUpperCase();
        if (!code) {
          alert('Please enter a Room Code to join.');
          return;
        }
        await connectionHub.connectViaRoom(code, false);
        this.modals.closeModal('modal-connect');
      });
    }

    // Direct Socket Actions: Start Server / Connect Client
    const btnStartServer = document.getElementById('btn-start-direct-server');
    const btnConnectSocket = document.getElementById('btn-connect-direct-socket');
    const hostPortInput = document.getElementById('input-host-port');
    const targetIpInput = document.getElementById('input-target-ip');
    const targetPortInput = document.getElementById('input-target-port');

    if (btnStartServer) {
      btnStartServer.addEventListener('click', async () => {
        const port = parseInt(hostPortInput.value, 10) || 48800;
        await connectionHub.startDirectServer(port);
        this.modals.closeModal('modal-connect');
      });
    }

    if (btnConnectSocket) {
      btnConnectSocket.addEventListener('click', async () => {
        const ip = targetIpInput.value.trim();
        const port = parseInt(targetPortInput.value, 10) || 48800;
        if (!ip) {
          alert("Please enter friend's IP address.");
          return;
        }
        await connectionHub.connectDirectSocket(ip, port);
        this.modals.closeModal('modal-connect');
      });
    }

    // Manual Ticket Actions
    const ticketArea = document.getElementById('ticket-text-area');
    const btnGenOffer = document.getElementById('btn-gen-offer-ticket');
    const btnAcceptOffer = document.getElementById('btn-accept-offer-ticket');
    const btnApplyAnswer = document.getElementById('btn-apply-answer-ticket');

    if (btnGenOffer && ticketArea) {
      btnGenOffer.addEventListener('click', async () => {
        btnGenOffer.textContent = 'Generating...';
        const ticket = await connectionHub.createManualTicket();
        ticketArea.value = ticket;
        ticketArea.select();
        navigator.clipboard.writeText(ticket);
        btnGenOffer.textContent = '✓ Copied Offer Ticket';
      });
    }

    if (btnAcceptOffer && ticketArea) {
      btnAcceptOffer.addEventListener('click', async () => {
        const ticket = ticketArea.value.trim();
        if (!ticket) {
          alert('Paste the Offer Ticket into the box first.');
          return;
        }
        btnAcceptOffer.textContent = 'Creating Answer...';
        const answer = await connectionHub.acceptManualTicket(ticket);
        ticketArea.value = answer;
        ticketArea.select();
        navigator.clipboard.writeText(answer);
        btnAcceptOffer.textContent = '✓ Copied Answer Ticket';
      });
    }

    if (btnApplyAnswer && ticketArea) {
      btnApplyAnswer.addEventListener('click', async () => {
        const ticket = ticketArea.value.trim();
        if (!ticket) {
          alert('Paste the Answer Ticket into the box.');
          return;
        }
        await connectionHub.applyManualAnswer(ticket);
        this.modals.closeModal('modal-connect');
      });
    }

    // Disconnect peer button
    const disconnectBtn = document.getElementById('btn-disconnect-peer');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => {
        connectionHub.disconnect();
      });
    }
  }

  initConnectionHubEvents() {
    // State changes
    connectionHub.on('state', (state) => {
      this.updateConnectionStateUI(state);
    });

    // Chat messages
    connectionHub.on('chat', (msg) => {
      this.chatView.addMessage(msg, false, connectionHub.peerProfile);
    });

    // Reactions
    connectionHub.on('reaction', (reaction) => {
      this.chatView.addReaction(reaction.messageId, reaction.emoji, reaction.from);
    });

    // File progress & complete
    connectionHub.on('fileProgress', (prog) => {
      this.chatView.renderFileTransfer(prog);
    });

    connectionHub.on('fileComplete', (fileData) => {
      this.chatView.completeFileTransfer(fileData);
    });

    // Peer profile update
    connectionHub.on('profile', (profile) => {
      this.updatePeerProfileUI(profile);
    });

    // Typing status
    connectionHub.on('typing', (typing) => {
      const indicator = document.getElementById('typing-indicator');
      const typingText = document.getElementById('typing-text');
      if (indicator) {
        if (typing.isTyping) {
          if (typingText) typingText.textContent = `${typing.from || 'Friend'} is typing...`;
          indicator.style.display = 'flex';
        } else {
          indicator.style.display = 'none';
        }
      }
    });
  }

  updateConnectionStateUI(state) {
    const statusDot = document.getElementById('header-status-dot');
    const statusText = document.getElementById('header-status-text');
    const idleCard = document.getElementById('peer-idle-card');
    const connectedCard = document.getElementById('peer-connected-card');
    const chatHeaderDot = document.getElementById('chat-header-dot');
    const chatHeaderDesc = document.getElementById('chat-header-status-desc');

    if (state.status === 'connected') {
      if (statusDot) {
        statusDot.className = 'status-dot connected';
      }
      if (statusText) {
        statusText.textContent = 'P2P 연결됨';
      }
      if (idleCard) idleCard.style.display = 'none';
      if (connectedCard) connectedCard.style.display = 'flex';

      if (chatHeaderDot) chatHeaderDot.className = 'status-dot connected';
      if (chatHeaderDesc) chatHeaderDesc.textContent = 'P2P 직접 채널 활성화';

      const channelType = document.getElementById('metric-channel-type');
      if (channelType) {
        channelType.textContent = state.method === 'direct' ? 'Direct TCP/WS 소켓' : 'WebRTC P2P DataChannel';
      }
    } else if (state.status === 'connecting' || state.status === 'hosting-socket') {
      if (statusDot) {
        statusDot.className = 'status-dot connecting';
      }
      if (statusText) {
        statusText.textContent = state.status === 'hosting-socket' ? `포트 :${state.port} 수신 대기중` : '연결 시도중...';
      }
      if (chatHeaderDot) chatHeaderDot.className = 'status-dot connecting';
      if (chatHeaderDesc) chatHeaderDesc.textContent = 'P2P 연결 수립중...';
    } else {
      if (statusDot) {
        statusDot.className = 'status-dot';
      }
      if (statusText) {
        statusText.textContent = '연결 대기중';
      }
      if (idleCard) idleCard.style.display = 'flex';
      if (connectedCard) connectedCard.style.display = 'none';

      if (chatHeaderDot) chatHeaderDot.className = 'status-dot';
      if (chatHeaderDesc) chatHeaderDesc.textContent = '상대방 연결 대기중...';

      const pingDisplay = document.getElementById('header-ping-display');
      if (pingDisplay) pingDisplay.textContent = 'P2P HUD';
    }
  }

  updatePeerProfileUI(profile) {
    if (!profile) return;
    const peerAvatar = document.getElementById('peer-avatar-box');
    const peerName = document.getElementById('peer-display-name');
    const peerBio = document.getElementById('peer-display-bio');

    const chatAvatar = document.getElementById('chat-header-avatar-box');
    const chatName = document.getElementById('chat-header-name');

    const name = profile.name || '상대방';
    const initial = name.charAt(0).toUpperCase();
    const color = profile.color || '#52525b';

    if (peerAvatar) {
      peerAvatar.textContent = initial;
      peerAvatar.style.backgroundColor = color;
    }
    if (peerName) peerName.textContent = name;
    if (peerBio) peerBio.textContent = profile.bio || 'P2P 활성';

    if (chatAvatar) {
      chatAvatar.textContent = initial;
      chatAvatar.style.backgroundColor = color;
    }
    if (chatName) chatName.textContent = name;
  }

  startPeriodicStatsPoller() {
    setInterval(() => {
      if (connectionHub.mode === 'connected') {
        const diag = connectionHub.getDiagnostics();
        const pingDisplay = document.getElementById('header-ping-display');
        const metricLatency = document.getElementById('metric-latency');
        const metricPeerIp = document.getElementById('metric-peer-ip');

        const lat = diag.network && diag.network.roundTripTimeMs ? `${diag.network.roundTripTimeMs} ms` : (diag.latencyMs ? `${diag.latencyMs} ms` : '1 ms');

        if (pingDisplay) pingDisplay.textContent = lat;
        if (metricLatency) metricLatency.textContent = lat;

        if (metricPeerIp) {
          if (diag.network && diag.network.remoteIp) {
            metricPeerIp.textContent = `${diag.network.remoteIp}:${diag.network.remotePort || ''}`;
          } else if (diag.remoteIp) {
            metricPeerIp.textContent = `${diag.remoteIp}:${diag.port || ''}`;
          }
        }
      }
    }, 2000);
  }
}

// Start application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new MessroomApp();
  app.init();
});
