/**
 * Chat View Renderer for Messroom
 * Handles message list, solid cards, markdown parsing, and chunked file transfer.
 * NO emojis - uses Google Material symbols.
 */

import { accountManager } from '../profile/account-manager.js';

export class ChatView {
  constructor(containerEl, emptyStateEl) {
    this.container = containerEl;
    this.emptyState = emptyStateEl;
    this.messages = [];
    this.fileElements = new Map();
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatMarkdown(raw) {
    let text = this.escapeHtml(raw);

    // Code blocks ```code```
    text = text.replace(/```([\s\S]*?)```/g, (match, p1) => {
      return `<pre><code>${p1.trim()}</code></pre>`;
    });

    // Inline code `code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *text*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // URLs to links
    text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: var(--accent-blue); text-decoration: underline;">$1</a>');

    // Newlines to <br>
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  formatTime(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  hideEmptyState() {
    if (this.emptyState) {
      this.emptyState.style.display = 'none';
    }
  }

  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }

  addMessage(msg, isOutgoing = false, peerProfile = null) {
    this.hideEmptyState();
    this.messages.push({ ...msg, isOutgoing });

    const activeUser = accountManager.getActive();
    const color = isOutgoing
      ? (activeUser && activeUser.color ? activeUser.color : '#2563eb')
      : (peerProfile && peerProfile.color ? peerProfile.color : '#52525b');
    const senderName = isOutgoing ? '나' : (msg.sender || (peerProfile ? peerProfile.name : '상대방'));
    const initial = (senderName || 'P').charAt(0).toUpperCase();

    const row = document.createElement('div');
    row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
    row.dataset.messageId = msg.id;

    row.innerHTML = `
      <div class="avatar-box" style="background-color: ${color}; width: 32px; height: 32px; font-size: 13px;">${initial}</div>
      <div class="message-content-wrapper">
        <div class="message-meta">
          <span style="font-weight: 700;">${this.escapeHtml(senderName)}</span>
          <span>${this.formatTime(msg.timestamp)}</span>
        </div>
        <div class="message-bubble">
          ${this.formatMarkdown(msg.text)}
        </div>
      </div>
    `;

    this.container.appendChild(row);
    this.scrollToBottom();
    return row;
  }

  renderFileTransfer(prog) {
    this.hideEmptyState();

    let card = this.fileElements.get(prog.fileId);
    if (!card) {
      const row = document.createElement('div');
      row.className = `message-row ${prog.isIncoming ? 'incoming' : 'outgoing'}`;

      const activeUser = accountManager.getActive();
      const color = prog.isIncoming ? '#52525b' : (activeUser && activeUser.color ? activeUser.color : '#2563eb');
      const senderName = prog.isIncoming ? '상대방' : '나';
      const initial = (senderName || 'P').charAt(0).toUpperCase();

      row.innerHTML = `
        <div class="avatar-box" style="background-color: ${color}; width: 32px; height: 32px; font-size: 13px;">${initial}</div>
        <div class="message-content-wrapper">
          <div class="message-meta">
            <span style="font-weight: 700;">${senderName}</span>
            <span>${this.formatTime(Date.now())}</span>
          </div>
          <div class="file-card" id="filecard-${prog.fileId}">
            <span class="material-symbols-outlined" style="font-size: 28px; color: var(--accent-blue);">description</span>
            <div class="file-info">
              <div class="file-name" title="${this.escapeHtml(prog.fileName)}">${this.escapeHtml(prog.fileName)}</div>
              <div class="file-size">${this.formatBytes(prog.fileSize)} • <span class="transfer-status">${prog.percent}%</span></div>
              <div class="file-progress-bar-bg">
                <div class="file-progress-bar-fill" style="width: ${prog.percent}%"></div>
              </div>
            </div>
            <div class="file-action-slot">
              <span style="font-size: 11px; color: var(--accent-blue); font-weight: 700;">${this.formatBytes(prog.speedBytesPerSec)}/s</span>
            </div>
          </div>
        </div>
      `;

      this.container.appendChild(row);
      this.fileElements.set(prog.fileId, row);
      card = row;
      this.scrollToBottom();
    } else {
      const fill = card.querySelector('.file-progress-bar-fill');
      const status = card.querySelector('.transfer-status');
      const speedSlot = card.querySelector('.file-action-slot');

      if (fill) fill.style.width = `${prog.percent}%`;
      if (status) status.textContent = `${prog.percent}%`;
      if (speedSlot) {
        speedSlot.innerHTML = `<span style="font-size: 11px; color: var(--accent-blue); font-weight: 700;">${this.formatBytes(prog.speedBytesPerSec)}/s</span>`;
      }
    }
  }

  completeFileTransfer(fileData) {
    const card = this.fileElements.get(fileData.fileId);
    if (!card) return;

    const fill = card.querySelector('.file-progress-bar-fill');
    const status = card.querySelector('.transfer-status');
    const speedSlot = card.querySelector('.file-action-slot');

    if (fill) fill.style.width = '100%';
    if (status) status.textContent = '완료';

    if (speedSlot) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'file-download-btn';
      downloadBtn.innerHTML = '<span class="material-symbols-outlined icon-sm" style="vertical-align: middle;">download</span> 파일 저장';
      downloadBtn.onclick = async () => {
        if (window.messroomAPI && window.messroomAPI.saveFile) {
          const buffer = await fileData.blob.arrayBuffer();
          await window.messroomAPI.saveFile(fileData.fileName, buffer);
        } else {
          const url = URL.createObjectURL(fileData.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileData.fileName;
          a.click();
          URL.revokeObjectURL(url);
        }
      };
      speedSlot.innerHTML = '';
      speedSlot.appendChild(downloadBtn);
    }

    if (fileData.fileType && fileData.fileType.startsWith('image/')) {
      const url = URL.createObjectURL(fileData.blob);
      const img = document.createElement('img');
      img.src = url;
      img.className = 'chat-image-preview';
      img.style.marginTop = '6px';
      img.onclick = () => {
        const lightbox = document.getElementById('modal-lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        if (lightbox && lightboxImg) {
          lightboxImg.src = url;
          lightbox.classList.add('active');
        }
      };
      const wrapper = card.querySelector('.message-content-wrapper');
      if (wrapper) wrapper.appendChild(img);
    }

    this.scrollToBottom();
  }

  clear() {
    this.messages = [];
    this.fileElements.clear();
    this.container.innerHTML = '';
    if (this.emptyState) {
      this.container.appendChild(this.emptyState);
      this.emptyState.style.display = 'flex';
    }
  }

  exportText() {
    if (this.messages.length === 0) return '채팅 내역이 없습니다.';
    return this.messages.map(m => {
      const time = new Date(m.timestamp).toLocaleString();
      const sender = m.isOutgoing ? '나' : (m.sender || '상대방');
      return `[${time}] ${sender}: ${m.text || '[파일 전송]'}`;
    }).join('\n');
  }
}
