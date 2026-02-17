import {
  type SpeedTestAdapter,
  type SpeedTestConfig,
  type SpeedTestCallbacks,
  type TestDirection,
  wsBase,
  randomPayload,
  calcSpeedMbps,
} from '../speedtest';

export type PairingState = 'disconnected' | 'lobby' | 'pair_requested' | 'pair_pending' | 'paired';

export interface LobbyPeer {
  id: string;
  name: string;
}

export interface PairRequest {
  fromId: string;
  fromName: string;
}

export interface WebRtcEvents {
  onPairingStateChange: (state: PairingState) => void;
  onLobbyUpdate: (peers: LobbyPeer[]) => void;
  onPairRequest: (request: PairRequest) => void;
  onPaired: (partnerId: string) => void;
  onUnpaired: () => void;
  onPeerTestStart: (config: SpeedTestConfig & { initiatorDirection: TestDirection }) => void;
  onPeerTestStop: () => void;
  onPeerTestUpdate: (progress: { direction: TestDirection; speed: number; bytes: number; elapsed: number }) => void;
  onError: (error: string) => void;
}

export class WebRtcAdapter implements SpeedTestAdapter {
  readonly name = 'WebRTC';

  private signalingWs: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private running = false;
  private stopResolve: (() => void) | null = null;
  
  private events: WebRtcEvents;
  private deviceId: string;
  private deviceName: string;
  private partnerId: string | null = null;
  
  // Internal state
  private _peers: LobbyPeer[] = [];
  
  constructor(events: WebRtcEvents) {
    this.events = events;
    
    // Load or generate device identity
    let id = localStorage.getItem('speedbox_device_id');
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
      }
      localStorage.setItem('speedbox_device_id', id);
    }
    this.deviceId = id;

    let name = localStorage.getItem('speedbox_device_name');
    if (!name) {
      name = typeof navigator !== 'undefined' ? (navigator.platform || 'Unknown Device') : 'Unknown Device';
      localStorage.setItem('speedbox_device_name', name);
    }
    this.deviceName = name;
  }
  
  private setPairingState(state: PairingState) {
    this.events.onPairingStateChange(state);
  }

  // -------------------------------------------------------------------------
  // Lifecycle & Pairing
  // -------------------------------------------------------------------------

  connect(): void {
    if (this.signalingWs) return;

    const url = `${wsBase()}/ws/signal`;
    const ws = new WebSocket(url);
    this.signalingWs = ws;

    ws.onopen = () => {
      this.sendJson('HELLO', { name: this.deviceName, id: this.deviceId });
    };

    ws.onmessage = (e) => {
      this.handleMessage(e.data as string);
    };

    ws.onclose = () => {
      this.signalingWs = null;
      this.cleanupPeerConnection();
      this.setPairingState('disconnected');
    };

    ws.onerror = () => {
      this.events.onError('Signaling connection error');
    };
  }

  disconnect(): void {
    this.cleanupPeerConnection();
    if (this.signalingWs) {
      this.signalingWs.close();
      this.signalingWs = null;
    }
    this.setPairingState('disconnected');
  }

  requestPair(targetId: string): void {
    this.send('PAIR_REQUEST', targetId);
    this.setPairingState('pair_pending');
  }

  acceptPair(requesterId: string): void {
    this.send('PAIR_ACCEPT', requesterId);
  }

  rejectPair(requesterId: string): void {
    this.send('PAIR_REJECT', requesterId);
  }

  unpair(): void {
    this.send('UNPAIR');
    this.cleanupPeerConnection();
    this.partnerId = null;
    this.setPairingState('lobby');
    this.events.onUnpaired();
  }

  private send(cmd: string, payload: string = ''): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(payload ? `${cmd} ${payload}` : cmd);
    }
  }

  private sendJson(cmd: string, data: object): void {
    this.send(cmd, JSON.stringify(data));
  }

  private handleMessage(msg: string): void {
    const spaceIdx = msg.indexOf(' ');
    const cmd = spaceIdx === -1 ? msg : msg.slice(0, spaceIdx);
    const payload = spaceIdx === -1 ? '' : msg.slice(spaceIdx + 1);

    switch (cmd) {
      case 'HELLO_OK':
        this.setPairingState('lobby');
        break;
      
      case 'LOBBY':
        try {
          const peers = JSON.parse(payload) as LobbyPeer[];
          this._peers = peers;
          this.events.onLobbyUpdate(peers);
        } catch (e) { console.error('Invalid LOBBY payload', e); }
        break;
        
      case 'PEER_JOINED':
        this.handlePeerJoined(payload);
        break;
        
      case 'PEER_LEFT':
        this.handlePeerLeft(payload);
        break;
        
      case 'PAIR_REQUEST':
        const firstSpace = payload.indexOf(' ');
        if (firstSpace !== -1) {
          const fromId = payload.slice(0, firstSpace);
          const fromName = payload.slice(firstSpace + 1);
          this.events.onPairRequest({ fromId, fromName });
          this.setPairingState('pair_requested');
        }
        break;
        
      case 'PAIRED':
        this.partnerId = payload;
        this.setPairingState('paired');
        this.events.onPaired(payload);
        this.setupPeerConnection();
        break;
        
      case 'PAIR_REJECTED':
        this.setPairingState('lobby');
        this.events.onError(`Pairing rejected: ${payload}`);
        break;
        
      case 'UNPAIRED':
        this.cleanupPeerConnection();
        this.partnerId = null;
        this.setPairingState('lobby');
        this.events.onUnpaired();
        break;
        
      case 'SIGNAL':
        const sigSpace = payload.indexOf(' ');
        if (sigSpace !== -1) {
          const json = payload.slice(sigSpace + 1);
          this.handleSignal(json);
        }
        break;
        
      case 'PING':
        this.send('PONG');
        break;
        
      case 'TEST_START':
        try {
          const data = JSON.parse(payload);
          if (data.initiatorDirection) {
            this.events.onPeerTestStart(data);
          }
        } catch (e) { console.error('Invalid TEST_START', e); }
        break;
        
      case 'TEST_STOP':
        this.events.onPeerTestStop();
        break;
        
      case 'TEST_UPDATE':
        try {
          this.events.onPeerTestUpdate(JSON.parse(payload));
        } catch (e) { }
        break;
    }
  }

  // Lobby management helpers
  
  private handlePeerJoined(json: string) {
    try {
      const peer = JSON.parse(json) as LobbyPeer;
      if (!this._peers.find(p => p.id === peer.id)) {
        this._peers.push(peer);
        this.events.onLobbyUpdate([...this._peers]);
      }
    } catch (e) {}
  }

  private handlePeerLeft(uuid: string) {
    this._peers = this._peers.filter(p => p.id !== uuid);
    this.events.onLobbyUpdate([...this._peers]);
  }

  // -------------------------------------------------------------------------
  // WebRTC Setup
  // -------------------------------------------------------------------------

  private async setupPeerConnection(): Promise<void> {
    if (!this.partnerId) return;

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.peerConnection = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && this.partnerId) {
        this.sendSignal(this.partnerId!, {
          type: 'candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    // Determine who creates the offer: alphabetically lower UUID
    const isOfferer = this.deviceId < this.partnerId;

    if (isOfferer) {
      const dc = pc.createDataChannel('speedtest', {
        ordered: false,
        maxRetransmits: 0,
      });
      dc.binaryType = 'arraybuffer';
      this.setupDataChannel(dc);
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(this.partnerId, { type: 'offer', sdp: offer.sdp });
    } else {
      pc.ondatachannel = (e) => {
        this.setupDataChannel(e.channel);
      };
    }
  }

  private setupDataChannel(dc: RTCDataChannel) {
    this.dataChannel = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      // Ready
    };
    dc.onclose = () => {
      // Channel closed
    };
  }

  private async handleSignal(json: string) {
    if (!this.peerConnection) return;
    
    try {
      const data = JSON.parse(json);
      const pc = this.peerConnection;

      if (data.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (this.partnerId) {
          this.sendSignal(this.partnerId, { type: 'answer', sdp: answer.sdp });
        }
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else if (data.type === 'candidate') {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (e) {
      console.error('Signal error', e);
    }
  }

  private sendSignal(targetId: string, data: object) {
    this.send('SIGNAL', `${targetId} ${JSON.stringify(data)}`);
  }

  private cleanupPeerConnection() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  // -------------------------------------------------------------------------
  // SpeedTestAdapter Interface
  // -------------------------------------------------------------------------

  async start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    this.sendTestStart(config, direction);
    await this.runTest(direction, config, callbacks);
  }
  
  async startRemote(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    await this.runTest(direction, config, callbacks);
  }

  stop(): void {
    this.running = false;
    this.sendTestStop();
    if (this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
    }
  }

  destroy(): void {
    this.disconnect();
  }

  sendTestStart(config: SpeedTestConfig, direction: TestDirection) {
    this.sendJson('TEST_START', { ...config, initiatorDirection: direction });
  }

  sendTestStop() {
    this.send('TEST_STOP');
  }

  sendTestUpdate(progress: any) {
    this.sendJson('TEST_UPDATE', progress);
  }

  // -------------------------------------------------------------------------
  // Test Execution
  // -------------------------------------------------------------------------

  private async runTest(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      callbacks.onError('Data channel not open');
      return;
    }

    this.running = true;
    callbacks.onStateChange(
      direction === 'download' ? 'downloading' : 'uploading'
    );

    const isSender = direction === 'upload';

    try {
      if (isSender) {
        await this.sendData(this.dataChannel, config, direction, callbacks);
      } else {
        await this.receiveData(this.dataChannel, config, direction, callbacks);
      }
      callbacks.onStateChange('done');
    } catch (e) {
      callbacks.onError((e as Error).message);
      callbacks.onStateChange('error');
    } finally {
      this.running = false;
    }
  }

  private sendData(
    dc: RTCDataChannel,
    config: SpeedTestConfig,
    direction: TestDirection,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    return new Promise((resolve) => {
      const payload = randomPayload(config.packetSize);
      let totalBytes = 0;
      const t0 = performance.now();
      let lastUpdate = 0;

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          dc.send('STOP');
          resolve();
        }, config.duration * 1000);
      }

      this.stopResolve = () => {
        if (timer) clearTimeout(timer);
        try { dc.send('STOP'); } catch {}
        resolve();
      };

      dc.send('START');

      const sendLoop = () => {
        if (!this.running) {
           return;
        }

        while (
          dc.readyState === 'open' &&
          dc.bufferedAmount < config.packetSize * 8
        ) {
          dc.send(payload as any);
          totalBytes += payload.byteLength;

          const now = performance.now();
          const elapsed = (now - t0) / 1000;
          const progress = {
            totalBytes,
            elapsed,
            speedMbps: calcSpeedMbps(totalBytes, elapsed),
          };
          
          callbacks.onProgress(direction, progress);

          if (now - lastUpdate > 500) {
            this.sendTestUpdate({ ...progress, direction });
            lastUpdate = now;
          }
        }

        if (dc.readyState === 'open') {
          setTimeout(sendLoop, 1);
        } else {
          resolve();
        }
      };

      sendLoop();
    });
  }

  private receiveData(
    dc: RTCDataChannel,
    config: SpeedTestConfig,
    direction: TestDirection,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    return new Promise((resolve) => {
      let totalBytes = 0;
      let t0 = 0;
      let started = false;
      let lastUpdate = 0;

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          resolve();
        }, (config.duration + 2) * 1000);
      }

      this.stopResolve = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      dc.onmessage = (e) => {
        if (typeof e.data === 'string') {
          if (e.data === 'START') {
            started = true;
            t0 = performance.now();
            totalBytes = 0;
          } else if (e.data === 'STOP') {
            if (timer) clearTimeout(timer);
            resolve();
          }
          return;
        }

        if (!started) return;

        totalBytes += (e.data as ArrayBuffer).byteLength;
        const now = performance.now();
        const elapsed = (now - t0) / 1000;
        const progress = {
          totalBytes,
          elapsed,
          speedMbps: calcSpeedMbps(totalBytes, elapsed),
        };
        
        callbacks.onProgress(direction, progress);
        
        if (now - lastUpdate > 500) {
          this.sendTestUpdate({ ...progress, direction });
          lastUpdate = now;
        }
      };
    });
  }
}
