/**
 * Modal Manager for Messroom
 * Handles Connection Hub modal, Profile & Account modal, and Network Diagnostics HUD.
 */

import { accountManager } from '../profile/account-manager.js';
import { connectionHub } from '../p2p/connection-hub.js';

export class ModalManager {
  constructor() {
    this.selectedAvatar = null;
    this.selectedTheme = 'cyberpunk';
    this.initListeners();
  }

  initListeners() {
    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.getAttribute('data-close-modal');
        this.closeModal(modalId);
      });
    });

    // Close on overlay backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      }
    });

    // Modal Tabs
    document.querySelectorAll('.modal-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const targetTabId = tabBtn.getAttribute('data-tab');
        const modalBody = tabBtn.closest('.modal-body');
        if (!modalBody) return;

        modalBody.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        modalBody.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

        tabBtn.classList.add('active');
        const pane = document.getElementById(targetTabId);
        if (pane) pane.style.display = 'block';
      });
    });

    // Solid Color picker selection
    document.querySelectorAll('.color-box').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.color-box').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedColor = item.getAttribute('data-color');
      });
    });

    // Save Profile button
    const saveProfileBtn = document.getElementById('btn-save-profile');
    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('profile-name-input');
        const bioInput = document.getElementById('profile-bio-input');

        const updates = {
          name: nameInput.value.trim() || '사용자',
          bio: bioInput.value.trim() || '온라인 (P2P 통신 대기)',
          color: this.selectedColor || '#2563eb'
        };

        accountManager.updateActiveProfile(updates);
        connectionHub.syncProfile();
        this.closeModal('modal-profile');
      });
    }

    // Refresh IP scan button
    const refreshBtn = document.getElementById('btn-refresh-network-info');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.updateNetworkHUD();
      });
    }
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (modalId === 'modal-profile') {
      this.populateProfileForm();
    } else if (modalId === 'modal-network' || modalId === 'modal-connect') {
      this.updateNetworkHUD();
    }

    modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  populateProfileForm() {
    const user = accountManager.getActive();
    if (!user) return;

    const nameInput = document.getElementById('profile-name-input');
    const bioInput = document.getElementById('profile-bio-input');

    if (nameInput) nameInput.value = user.name;
    if (bioInput) bioInput.value = user.bio;

    this.selectedColor = user.color || '#2563eb';
    document.querySelectorAll('.color-box').forEach(item => {
      item.classList.toggle('selected', item.getAttribute('data-color') === this.selectedColor);
    });
  }

  async updateNetworkHUD() {
    let localIps = [];
    let publicIp = '조회중...';

    if (window.messroomAPI && window.messroomAPI.getNetworkInfo) {
      try {
        const info = await window.messroomAPI.getNetworkInfo();
        localIps = info.localIps || [];
        publicIp = info.publicIp || '확인 불가';
      } catch (e) {
        console.error('Error fetching network info', e);
      }
    }

    const diag = connectionHub.getDiagnostics();

    // Direct connect tab elements
    const diagPub = document.getElementById('diag-my-public-ip');
    const diagLoc = document.getElementById('diag-my-local-ip');
    if (diagPub) diagPub.textContent = publicIp;
    if (diagLoc) diagLoc.textContent = localIps.map(i => `${i.iface}: ${i.address}`).join(' | ') || '127.0.0.1';

    // HUD modal elements
    const hudState = document.getElementById('hud-conn-state');
    const hudMode = document.getElementById('hud-conn-mode');
    const hudLocal = document.getElementById('hud-my-local-ip');
    const hudPub = document.getElementById('hud-my-public-ip');
    const hudPeer = document.getElementById('hud-peer-ip');
    const hudPort = document.getElementById('hud-peer-port');
    const hudCand = document.getElementById('hud-candidate-type');
    const hudLat = document.getElementById('hud-latency');

    if (hudState) hudState.textContent = diag.connected ? '연결됨 (P2P 직접 연결)' : '연결 대기';
    if (hudMode) hudMode.textContent = diag.method === 'direct-socket' ? 'Direct WebSocket Socket' : 'WebRTC RTCDataChannel';
    if (hudLocal) hudLocal.textContent = localIps.map(i => i.address).join(', ') || '127.0.0.1';
    if (hudPub) hudPub.textContent = publicIp;

    if (diag.network) {
      if (hudPeer) hudPeer.textContent = diag.network.remoteIp || '-';
      if (hudPort) hudPort.textContent = diag.network.remotePort || '-';
      if (hudCand) hudCand.textContent = diag.network.candidateType || 'srflx (STUN NAT Hole Punched)';
      if (hudLat) hudLat.textContent = (diag.network.roundTripTimeMs || diag.latencyMs || '-') + ' ms';
    } else if (diag.method === 'direct-socket') {
      if (hudPeer) hudPeer.textContent = diag.remoteIp || 'Direct Peer';
      if (hudPort) hudPort.textContent = diag.port || '48800';
      if (hudCand) hudCand.textContent = 'Direct TCP/WS Socket';
      if (hudLat) hudLat.textContent = '< 1 ms';
    } else {
      if (hudPeer) hudPeer.textContent = '-';
      if (hudPort) hudPort.textContent = '-';
      if (hudCand) hudCand.textContent = '-';
      if (hudLat) hudLat.textContent = '-';
    }
  }
}
