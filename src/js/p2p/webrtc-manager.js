/**
 * WebRTC P2P Connection Manager for Messroom
 * Handles RTCDataChannel for real-time messaging, chunked file transfer,
 * ping/latency metrics, and ICE candidate diagnostics.
 */

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for optimal throughput

export class WebRTCManager {
  constructor() {
    this.pc = null;
    this.dataChannel = null;
    this.localPeerId = 'peer_' + Math.random().toString(36).substring(2, 9);
    this.remotePeerId = null;
    this.isInitiator = false;

    // Incoming file reception state
    this.incomingFiles = new Map(); // fileId -> { meta, chunks: [], receivedBytes: 0, startTime: 0 }

    // Latency & network stats
    this.pingInterval = null;
    this.lastPingSent = 0;
    this.currentLatencyMs = null;
    this.remoteNetworkInfo = null;

    // Callbacks
    this.onStateChange = null;
    this.onMessageReceived = null;
    this.onFileTransferProgress = null;
    this.onFileTransferComplete = null;
    this.onSignalData = null; // function({ type, sdp, candidate })
    this.onRemoteTrack = null;
  }

  initPeerConnection() {
    this.cleanup();

    this.pc = new RTCPeerConnection({
      iceServers: STUN_SERVERS,
      iceCandidatePoolSize: 10
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onSignalData) {
        this.onSignalData({
          type: 'candidate',
          candidate: event.candidate
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc ? this.pc.connectionState : 'closed';
      if (this.onStateChange) this.onStateChange(state);
      if (state === 'connected') {
        this.startPingMonitor();
        this.inspectNetworkStats();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.stopPingMonitor();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.pc.ontrack = (event) => {
      if (this.onRemoteTrack) {
        this.onRemoteTrack(event.streams[0], event.track);
      }
    };
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      if (this.onStateChange) this.onStateChange('data-channel-open');
      this.startPingMonitor();
      this.inspectNetworkStats();
    };

    this.dataChannel.onclose = () => {
      if (this.onStateChange) this.onStateChange('data-channel-closed');
      this.stopPingMonitor();
    };

    this.dataChannel.onerror = (err) => {
      console.error('DataChannel error', err);
    };

    this.dataChannel.onmessage = (event) => {
      this.handleIncomingData(event.data);
    };
  }

  async createOffer() {
    this.isInitiator = true;
    this.initPeerConnection();

    // Initiator creates data channel
    const dc = this.pc.createDataChannel('messroom_chat', { ordered: true });
    this.setupDataChannel(dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    return offer;
  }

  async handleOffer(offer) {
    this.isInitiator = false;
    this.initPeerConnection();

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    return answer;
  }

  async handleAnswer(answer) {
    if (this.pc && this.pc.signalingState !== 'stable') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async addIceCandidate(candidate) {
    if (this.pc && candidate) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding ICE candidate', e);
      }
    }
  }

  sendPayload(payload) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return false;
    }
    const jsonStr = JSON.stringify(payload);
    this.dataChannel.send(jsonStr);
    return true;
  }

  handleIncomingData(data) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        this.processJsonMessage(msg);
      } catch (e) {
        console.error('Failed to parse incoming JSON', e);
      }
    } else if (data instanceof ArrayBuffer) {
      this.processBinaryChunk(data);
    }
  }

  processJsonMessage(msg) {
    switch (msg.type) {
      case 'PING':
        this.sendPayload({ type: 'PONG', timestamp: msg.timestamp });
        break;

      case 'PONG':
        if (msg.timestamp) {
          this.currentLatencyMs = Math.max(1, Math.round(Date.now() - msg.timestamp));
        }
        break;

      case 'FILE_HEADER':
        this.incomingFiles.set(msg.fileId, {
          meta: msg,
          chunks: [],
          receivedBytes: 0,
          startTime: Date.now()
        });
        if (this.onFileTransferProgress) {
          this.onFileTransferProgress({
            fileId: msg.fileId,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            receivedBytes: 0,
            percent: 0,
            speedBytesPerSec: 0,
            isIncoming: true
          });
        }
        break;

      case 'FILE_COMPLETE':
        this.finalizeIncomingFile(msg.fileId);
        break;

      default:
        if (this.onMessageReceived) {
          this.onMessageReceived(msg);
        }
        break;
    }
  }

  processBinaryChunk(buffer) {
    // Custom chunk header: 16 bytes fileId (string padded) + 4 bytes chunkIndex (Uint32)
    const view = new DataView(buffer);
    const fileIdLen = view.getUint8(0);
    const decoder = new TextDecoder();
    const fileId = decoder.decode(new Uint8Array(buffer, 1, fileIdLen));
    const chunkData = buffer.slice(1 + fileIdLen);

    const fileState = this.incomingFiles.get(fileId);
    if (!fileState) return;

    fileState.chunks.push(chunkData);
    fileState.receivedBytes += chunkData.byteLength;

    const percent = Math.min(100, Math.round((fileState.receivedBytes / fileState.meta.fileSize) * 100));
    const elapsedSec = (Date.now() - fileState.startTime) / 1000;
    const speed = elapsedSec > 0 ? Math.round(fileState.receivedBytes / elapsedSec) : 0;

    if (this.onFileTransferProgress) {
      this.onFileTransferProgress({
        fileId,
        fileName: fileState.meta.fileName,
        fileSize: fileState.meta.fileSize,
        receivedBytes: fileState.receivedBytes,
        percent,
        speedBytesPerSec: speed,
        isIncoming: true
      });
    }

    if (fileState.receivedBytes >= fileState.meta.fileSize) {
      this.finalizeIncomingFile(fileId);
    }
  }

  finalizeIncomingFile(fileId) {
    const fileState = this.incomingFiles.get(fileId);
    if (!fileState) return;

    const blob = new Blob(fileState.chunks, { type: fileState.meta.fileType || 'application/octet-stream' });
    this.incomingFiles.delete(fileId);

    if (this.onFileTransferComplete) {
      this.onFileTransferComplete({
        fileId,
        fileName: fileState.meta.fileName,
        fileSize: fileState.meta.fileSize,
        fileType: fileState.meta.fileType,
        blob,
        isIncoming: true
      });
    }
  }

  async sendFile(file, progressCallback) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('P2P connection not open');
    }

    const fileId = 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const fileSize = file.size;
    const fileName = file.name;
    const fileType = file.type;

    // Send header
    this.sendPayload({
      type: 'FILE_HEADER',
      fileId,
      fileName,
      fileSize,
      fileType
    });

    const buffer = await file.arrayBuffer();
    const encoder = new TextEncoder();
    const fileIdBytes = encoder.encode(fileId);
    const fileIdLen = fileIdBytes.length;

    let offset = 0;
    const startTime = Date.now();

    while (offset < fileSize) {
      // Buffer backpressure check
      if (this.dataChannel.bufferedAmount > 2 * 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 40));
      }

      const chunkSlice = buffer.slice(offset, offset + CHUNK_SIZE);
      const chunkPayload = new Uint8Array(1 + fileIdLen + chunkSlice.byteLength);

      chunkPayload[0] = fileIdLen;
      chunkPayload.set(fileIdBytes, 1);
      chunkPayload.set(new Uint8Array(chunkSlice), 1 + fileIdLen);

      this.dataChannel.send(chunkPayload.buffer);
      offset += chunkSlice.byteLength;

      const percent = Math.min(100, Math.round((offset / fileSize) * 100));
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speed = elapsedSec > 0 ? Math.round(offset / elapsedSec) : 0;

      if (progressCallback) {
        progressCallback({
          fileId,
          fileName,
          fileSize,
          sentBytes: offset,
          percent,
          speedBytesPerSec: speed,
          isIncoming: false
        });
      }
    }

    this.sendPayload({ type: 'FILE_COMPLETE', fileId });
    return { fileId, fileName, fileSize, fileType };
  }

  startPingMonitor() {
    this.stopPingMonitor();
    this.pingInterval = setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.lastPingSent = Date.now();
        this.sendPayload({ type: 'PING', timestamp: this.lastPingSent });
        this.inspectNetworkStats();
      }
    }, 2500);
  }

  stopPingMonitor() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async inspectNetworkStats() {
    if (!this.pc) return;
    try {
      const stats = await this.pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);

          if (remoteCandidate) {
            this.remoteNetworkInfo = {
              remoteIp: remoteCandidate.ip || remoteCandidate.address,
              remotePort: remoteCandidate.port,
              candidateType: remoteCandidate.candidateType, // 'host' | 'srflx' | 'prflx'
              protocol: remoteCandidate.protocol,
              localIp: localCandidate ? (localCandidate.ip || localCandidate.address) : null,
              localPort: localCandidate ? localCandidate.port : null,
              roundTripTimeMs: report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : this.currentLatencyMs
            };
          }
        }
      });
    } catch (e) {
      // stats may not be ready yet
    }
  }

  getDiagnostics() {
    return {
      connected: this.dataChannel ? this.dataChannel.readyState === 'open' : false,
      iceState: this.pc ? this.pc.iceConnectionState : 'closed',
      connectionState: this.pc ? this.pc.connectionState : 'closed',
      latencyMs: this.currentLatencyMs,
      network: this.remoteNetworkInfo
    };
  }

  cleanup() {
    this.stopPingMonitor();
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
    this.incomingFiles.clear();
    this.currentLatencyMs = null;
    this.remoteNetworkInfo = null;
  }
}
