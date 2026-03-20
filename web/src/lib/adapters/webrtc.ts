/**
 * WebRTC Speed Test Adapter.
 *
 * Protocol (matches backend src/protocol/signaling.rs for signaling):
 *   1. Connect to signaling server at ws://host/ws/signal.
 *   2. Send HELLO with device ID/Name to authenticate and join lobby.
 *   3. Discover nearby peers via LOBBY updates from signaling server.
 *   4. Initiate Pair Request to target peer and wait for PAIR_ACCEPT, or accept incoming requests.
 *   5. Setup RTCPeerConnection and exchange SDP offers/answers and ICE candidates via SIGNAL messages.
 *   6. Establish a single RTCDataChannel ('speedtest') between the paired peers.
 *
 * Test Execution (Data Channel):
 *   - Initiator sends 'TEST_START' (with config) via signaling to sync the test state.
 *   - Sender peer fires a 'START' string over the data channel to reset progress on the receiver.
 *   - Sender aggressively floods the data channel with continuous binary buffer chunks.
 *   - Receiver accumulates bytes, measures throughput, and periodically sends back 'TEST_UPDATE' stats over signaling.
 *   - On duration end or stop request, the sender sends a 'STOP' message over the data channel.
 */

import type { SpeedTestAdapter, SpeedTestConfig, SpeedTestCallbacks, TestDirection } from '../speedtest';

// ============================================================================
// Types
// ============================================================================

export type PairingState = 'disconnected' | 'connecting' | 'lobby' | 'pending' | 'paired';
export type TestState = 'idle' | 'initiator-down' | 'initiator-up' | 'passive-down' | 'passive-up';

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
  onPeerLeft: (peerId: string) => void;
  onPairRequest: (request: PairRequest) => void;
  onPaired: (partnerId: string, partnerName: string) => void;
  onUnpaired: () => void;
  onPeerTestStart: (config: SpeedTestConfig & { initiatorDirection: TestDirection; phase: number }) => void;
  onPeerTestStop: () => void;
  onPeerTestReset: () => void;
  onPeerTestUpdate: (progress: { direction: TestDirection; speed: number; bytes: number; elapsed: number; speedMbps?: number }) => void;
  onError: (error: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calcSpeedMbps(bytes: number, elapsedSec: number): number {
  if (elapsedSec <= 0) return 0;
  return (bytes * 8) / (elapsedSec * 1_000_000);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// ============================================================================
// WebRtcAdapter Class
// ============================================================================

/**
 * WebRTC Speed Test Adapter
 * 
 * Architecture:
 * - Single testState state machine
 * - Single AbortController for test cancellation
 * - Single data channel message handler that dispatches based on testState
 * - Initiator and passive roles are clearly separated
 */
export class WebRtcAdapter implements SpeedTestAdapter {
  readonly name = 'webrtc';
  
  // Identity
  private deviceId: string = generateId();
  private deviceName: string = 'WebRTC-' + generateId().substring(0, 6);
  
  // Connection state
  private signalingWs: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private _pairingState: PairingState = 'disconnected';
  private partnerId: string | null = null;
  
  // Test state machine
  private testState: TestState = 'idle';
  private abortController: AbortController | null = null;
  private testCallbacks: SpeedTestCallbacks | null = null;
  
  // Data channel state for receiving
  private receiveStartTime: number = 0;
  private receiveTotalBytes: number = 0;
  private receiveLastUpdate: number = 0;
  private receiveStopped: boolean = false;
  
  // Event callbacks
  private events: WebRtcEvents;
  
  // Message log for debugging
  private messageLog: { time: string; dir: 'in' | 'out'; cmd: string; payload?: string }[] = [];
  
  constructor(events: WebRtcEvents) {
    this.events = events;
  }
  
  // =========================================================================
  // Public Properties
  // =========================================================================
  
  get pairingState(): PairingState {
    return this._pairingState;
  }
  
  get id(): string {
    return this.deviceId;
  }
  
  get displayName(): string {
    return this.deviceName;
  }
  
  // =========================================================================
  // Connection Management
  // =========================================================================
  
  connect(signalingUrl: string): void {
    if (this.signalingWs) {
      this.signalingWs.close();
    }
    
    this.setPairingState('connecting');
    this.log('Connecting to signaling server:', signalingUrl);
    
    const ws = new WebSocket(signalingUrl);
    this.signalingWs = ws;
    
    ws.onopen = () => {
      this.log('WebSocket connected');
      ws.send(`HELLO ${JSON.stringify({ id: this.deviceId, name: this.deviceName })}`);
    };
    
    ws.onmessage = (e) => {
      this.handleSignalingMessage(e.data);
    };
    
    ws.onerror = (e) => {
      this.log('WebSocket error:', e);
      this.events.onError('WebSocket connection error');
    };
    
    ws.onclose = () => {
      this.log('WebSocket closed');
      this.setPairingState('disconnected');
      this.partnerId = null;
    };
  }
  
  disconnect(): void {
    if (this.signalingWs) {
      this.signalingWs.close();
      this.signalingWs = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.dataChannel = null;
    this.partnerId = null;
    this.setPairingState('disconnected');
  }
  
  private setPairingState(state: PairingState) {
    this._pairingState = state;
    this.events.onPairingStateChange(state);
  }
  
  // =========================================================================
  // Signaling Protocol
  // =========================================================================
  
  private handleSignalingMessage(data: string) {
    this.log('Signaling received:', data.substring(0, 200));
    
    const spaceIdx = data.indexOf(' ');
    const cmd = spaceIdx === -1 ? data : data.substring(0, spaceIdx);
    const payload = spaceIdx === -1 ? '' : data.substring(spaceIdx + 1);
    
    switch (cmd) {
      case 'HELLO_OK': {
        this.log('Server accepted HELLO');
        this.setPairingState('lobby');
        break;
      }
      
      case 'LOBBY': {
        // Lobby state: LOBBY <json>
        try {
          const peers = JSON.parse(payload);
          this.events.onLobbyUpdate(peers);
        } catch (e) {
          this.log('Failed to parse LOBBY payload:', e);
        }
        break;
      }
      
      case 'PEER_JOINED': {
        // New peer joined: PEER_JOINED <json>
        try {
          const peer = JSON.parse(payload);
          this.log('Peer joined:', peer);
        } catch (e) {
          this.log('Failed to parse PEER_JOINED payload:', e);
        }
        break;
      }
      
      case 'PEER_LEFT': {
        // Peer left: PEER_LEFT <id>
        this.log('Peer left:', payload);
        this.events.onPeerLeft(payload);
        break;
      }
      
      case 'PAIR_REQUEST': {
        // Incoming pair request: PAIR_REQUEST <json>
        try {
          const req = JSON.parse(payload);
          this.events.onPairRequest({ fromId: req.id, fromName: req.name });
        } catch (e) {
          this.log('Failed to parse PAIR_REQUEST payload:', e);
        }
        break;
      }
      
      case 'PAIR_ACCEPTED':
      case 'PAIRED': {
        try {
          const data = JSON.parse(payload);
          const partnerId = data.id;
          const partnerName = data.name;
          this.partnerId = partnerId;
          const isInitiator = this.deviceId < partnerId;
          this.log(`Pairing complete, isInitiator=${isInitiator} (myId=${this.deviceId}, partnerId=${partnerId}, partnerName=${partnerName})`);
          this.setPairingState('paired');
          this.events.onPaired(partnerId, partnerName);
          this.setupPeerConnection(isInitiator);
        } catch (e) {
          this.log('Failed to parse PAIRED payload:', e);
        }
        break;
      }
      
      case 'PAIR_REJECTED': {
        this.setPairingState('lobby');
        this.events.onError('Pair request rejected');
        break;
      }
      
      case 'UNPAIRED': {
        this.partnerId = null;
        this.setPairingState('lobby');
        this.events.onUnpaired();
        break;
      }
      
      case 'SIGNAL': {
        // WebRTC signaling: SIGNAL <json>
        try {
          const signal = JSON.parse(payload);
          this.handleSignal(signal);
        } catch (e) {
          this.log('Failed to parse SIGNAL payload:', e);
        }
        break;
      }
      
      case 'TEST_START':
      case 'TEST_STOP':
      case 'TEST_RESET':
      case 'TEST_UPDATE': {
        try {
          const testPayload = payload ? JSON.parse(payload) : null;
          this.handleTestCommand(cmd, testPayload);
        } catch (e) {
          this.log('Failed to parse test command payload:', e);
        }
        break;
      }
      
      case 'ERROR': {
        this.log('Server error:', payload);
        this.events.onError(payload);
        break;
      }
      
      default:
        this.log('Unknown signaling command:', cmd);
    }
  }
  
  private sendSignaling(cmd: string, payload?: any) {
    if (!this.signalingWs || this.signalingWs.readyState !== WebSocket.OPEN) {
      this.log('Cannot send: WebSocket not connected');
      return;
    }
    const msg = payload ? `${cmd} ${JSON.stringify(payload)}` : cmd;
    this.signalingWs.send(msg);
    this.log('Signaling sent:', msg.substring(0, 200));
  }
  
  // =========================================================================
  // Peer Connection (WebRTC)
  // =========================================================================
  
  private setupPeerConnection(isInitiator: boolean) {
    this.log(`Setting up peer connection, isInitiator=${isInitiator}`);
    
    if (!this.peerConnection) {
      const newPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.peerConnection = newPc;
      
      newPc.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendSignaling('SIGNAL', { type: 'ice-candidate', candidate: e.candidate });
        }
      };
      
      newPc.onconnectionstatechange = () => {
        this.log('Connection state:', newPc.connectionState);
        if (newPc.connectionState === 'disconnected' || newPc.connectionState === 'failed') {
          this.setPairingState('lobby');
        }
      };
      
      // Passive peer: listen for incoming data channel
      newPc.ondatachannel = (e) => {
        this.log('Received data channel from peer');
        this.setupDataChannel(e.channel);
      };
    }
    
    // Initiator: create data channel and offer
    if (isInitiator) {
      const dc = this.peerConnection.createDataChannel('speedtest', { ordered: false });
      this.setupDataChannel(dc);
      
      this.peerConnection.createOffer()
        .then(offer => this.peerConnection!.setLocalDescription(offer))
        .then(() => {
          this.sendSignaling('SIGNAL', { type: 'offer', sdp: this.peerConnection!.localDescription });
        });
    }
    // Passive peer: just wait for offer (handled in handleSignal)
  }
  
  private handleSignal(payload: any) {
    const pc = this.peerConnection;
    if (!pc) {
      // We're the answerer, create connection
      const newPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      this.peerConnection = newPc;
      
      newPc.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendSignaling('SIGNAL', { type: 'ice-candidate', candidate: e.candidate });
        }
      };
      
      newPc.onconnectionstatechange = () => {
        this.log('Connection state:', newPc.connectionState);
        if (newPc.connectionState === 'disconnected' || newPc.connectionState === 'failed') {
          this.events.onUnpaired();
          this.setPairingState('lobby');
        }
      };
      
      newPc.ondatachannel = (e) => {
        this.setupDataChannel(e.channel);
      };
    }
    
    const currentPc = this.peerConnection!;
    
    if (payload.type === 'offer') {
      currentPc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        .then(() => currentPc.createAnswer())
        .then(answer => currentPc.setLocalDescription(answer))
        .then(() => {
          this.sendSignaling('SIGNAL', { type: 'answer', sdp: currentPc.localDescription });
        });
    } else if (payload.type === 'answer') {
      currentPc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } else if (payload.type === 'ice-candidate') {
      currentPc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  }
  
  // =========================================================================
  // Data Channel
  // =========================================================================
  
  private setupDataChannel(dc: RTCDataChannel) {
    this.dataChannel = dc;
    
    dc.onopen = () => {
      this.log('Data channel open');
    };
    
    dc.onclose = () => {
      this.log('Data channel closed');
    };
    
    dc.onerror = (e) => {
      this.log('Data channel error:', e);
    };
    
    // Single message handler that dispatches based on testState
    dc.onmessage = (e) => this.handleDataChannelMessage(e);
  }
  
  private handleDataChannelMessage(e: MessageEvent) {
    // String messages are control commands
    if (typeof e.data === 'string') {
      this.handleControlMessage(e.data);
      return;
    }
    
    // Binary data is test payload
    this.handleTestData(e.data as ArrayBuffer);
  }
  
  private handleControlMessage(data: string) {
    this.log('Control message:', data.substring(0, 50));
    
    if (data === 'START') {
      this.receiveStartTime = performance.now();
      this.receiveTotalBytes = 0;
      this.receiveLastUpdate = performance.now();
      this.receiveStopped = false;
      this.log('Receive START - reset counters');
      return;
    }
    
    if (data === 'STOP') {
      this.log('Receive STOP');
      this.receiveStopped = true;
      return;
    }
    
    // JSON commands
    try {
      const msg = JSON.parse(data);
      if (msg.cmd === 'TEST_UPDATE') {
        this.events.onPeerTestUpdate(msg.payload);
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  private handleTestData(data: ArrayBuffer) {
    // Only process if we're in a receiving state
    if (this.testState !== 'initiator-down' && this.testState !== 'passive-down') {
      return;
    }
    
    this.receiveTotalBytes += data.byteLength;
    const now = performance.now();
    const elapsed = (now - this.receiveStartTime) / 1000;
    
    // Throttle updates to every 500ms
    if (now - this.receiveLastUpdate < 500) {
      return;
    }
    this.receiveLastUpdate = now;
    
    const speedMbps = calcSpeedMbps(this.receiveTotalBytes, elapsed);
    const direction: TestDirection = 'download';
    
    this.log(`Receive progress: ${(this.receiveTotalBytes / 1024 / 1024).toFixed(2)} MB, ${elapsed.toFixed(2)}s, ${speedMbps.toFixed(1)} Mbps`);
    
    // Notify local callbacks
    if (this.testCallbacks) {
      this.testCallbacks.onProgress(direction, {
        totalBytes: this.receiveTotalBytes,
        elapsed,
        speedMbps,
      });
    }
    
    // Send update to peer
    this.sendDataChannel({
      cmd: 'TEST_UPDATE',
      payload: { direction, speed: speedMbps, bytes: this.receiveTotalBytes, elapsed, speedMbps },
    });
  }
  
  private sendDataChannel(data: any) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }
  
  // =========================================================================
  // Test Commands (from peer via signaling)
  // =========================================================================
  
  private handleTestCommand(cmd: string, payload: any) {
    this.log('Test command received:', cmd);
    
    switch (cmd) {
      case 'TEST_START':
        this.events.onPeerTestStart(payload);
        break;
      case 'TEST_STOP':
        this.events.onPeerTestStop();
        this.abortTest();
        break;
      case 'TEST_RESET':
        this.events.onPeerTestReset();
        this.resetTest();
        break;
      case 'TEST_UPDATE':
        this.events.onPeerTestUpdate(payload);
        break;
    }
  }
  
  // =========================================================================
  // Pairing Actions
  // =========================================================================
  
  sendPairRequest(peerId: string): void {
    this.sendSignaling(`PAIR_REQUEST ${peerId}`);
  }
  
  acceptPairRequest(requesterId?: string): void {
    if (requesterId) {
      this.sendSignaling(`PAIR_ACCEPT ${requesterId}`);
    }
  }
  
  rejectPairRequest(requesterId?: string): void {
    if (requesterId) {
      this.sendSignaling(`PAIR_REJECT ${requesterId}`);
    }
  }
  
  unpair(): void {
    this.sendSignaling('UNPAIR');
    this.partnerId = null;
    this.events.onUnpaired();
  }
  
  // Send TEST_RESET to peer
  sendTestReset(): void {
    this.sendSignaling('TEST_RESET');
    this.resetTest();
  }
  
  // Aliases for backward compatibility with useWebRtcPairing hook
  requestPair(peerId: string): void { 
    this.sendPairRequest(peerId);
    // Transition to pending state while waiting for response
    this.setPairingState('pending');
  }
  acceptPair(fromId: string): void { this.acceptPairRequest(fromId); }
  rejectPair(fromId: string): void { this.rejectPairRequest(fromId); }
  
  // =========================================================================
  // Speed Test API (Initiator)
  // =========================================================================
  
  async start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    phase: number = 1
  ): Promise<void> {
    if (this.testState !== 'idle') {
      throw new Error('Test already in progress');
    }
    
    this.log(`Starting test: direction=${direction}, phase=${phase}`);
    
    this.testCallbacks = callbacks;
    this.abortController = new AbortController();
    this.testState = direction === 'download' ? 'initiator-down' : 'initiator-up';
    
    // Notify peer
    this.sendSignaling('TEST_START', { ...config, initiatorDirection: direction, phase });
    
    callbacks.onStateChange(direction === 'download' ? 'downloading' : 'uploading');
    
    const signal = this.abortController.signal;
    try {
      await this.runTest(direction, config, callbacks, signal);
    } catch (e) {
      this.log('Test error:', e);
      callbacks.onError(String(e));
    }
    
    this.testState = 'idle';
    // Check if test was interrupted (aborted before natural completion)
    if (signal.aborted) {
      callbacks.onStateChange('interrupted');
    } else {
      callbacks.onStateChange('done');
    }
  }
  
  stop(): void {
    this.log('stop() called - initiator stopping');
    this.abortTest();
    this.sendSignaling('TEST_STOP');
  }
  
  // =========================================================================
  // Speed Test API (Passive)
  // =========================================================================
  
  /**
   * Called when peer sends TEST_START. Starts test in opposite direction.
   */
  async startRemote(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    if (this.testState !== 'idle') {
      this.log('startRemote called but testState is not idle:', this.testState);
      return;
    }
    
    this.log(`Starting remote test: direction=${direction}`);
    
    this.testCallbacks = callbacks;
    this.abortController = new AbortController();
    this.testState = direction === 'download' ? 'passive-down' : 'passive-up';
    
    callbacks.onStateChange(direction === 'download' ? 'downloading' : 'uploading');
    
    const signal = this.abortController.signal;
    try {
      await this.runTest(direction, config, callbacks, signal);
    } catch (e) {
      this.log('Remote test error:', e);
      callbacks.onError(String(e));
    }
    
    this.testState = 'idle';
    // Check if test was interrupted (aborted before natural completion)
    if (signal.aborted) {
      callbacks.onStateChange('interrupted');
    } else {
      callbacks.onStateChange('done');
    }
  }
  
  // =========================================================================
  // Test Execution
  // =========================================================================
  
  private async runTest(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const dc = this.dataChannel;
    if (!dc || dc.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }
    
    const isSender = direction === 'upload';
    this.log(`runTest: direction=${direction}, isSender=${isSender}`);
    
    if (isSender) {
      await this.runSender(dc, config, callbacks, signal);
    } else {
      await this.runReceiver(dc, config, callbacks, signal);
    }
  }
  
  /**
   * Sender: sends data through data channel
   */
  private async runSender(
    dc: RTCDataChannel,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const chunkSize = 65536; // 64KB chunks
    const buffer = new Uint8Array(chunkSize);
    // Fill with random data
    for (let i = 0; i < chunkSize; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    
    let totalBytes = 0;
    const startTime = performance.now();
    let lastUpdate = startTime;
    const durationMs = config.duration * 1000;
    
    this.log(`runSender: sending START`);
    dc.send('START');
    
    const sendLoop = (): Promise<void> => {
      return new Promise((resolve) => {
        const send = () => {
          if (signal.aborted) {
            this.log('runSender: aborted');
            dc.send('STOP');
            resolve();
            return;
          }
          
          if (performance.now() - startTime >= durationMs) {
            this.log('runSender: duration reached');
            dc.send('STOP');
            resolve();
            return;
          }
          
          // Fill buffer aggressively up to 1MB
          const targetBuffer = 1024 * 1024;
          while (dc.bufferedAmount < targetBuffer) {
            // Re-check conditions inside loop
            if (signal.aborted || performance.now() - startTime >= durationMs) {
              break;
            }
            dc.send(buffer);
            totalBytes += chunkSize;
          }
          
          const now = performance.now();
          if (now - lastUpdate >= 500) {
            const elapsed = (now - startTime) / 1000;
            const speedMbps = calcSpeedMbps(totalBytes, elapsed);
            
            this.log(`send progress: ${(totalBytes / 1024 / 1024).toFixed(2)} MB, ${elapsed.toFixed(2)}s, ${speedMbps.toFixed(1)} Mbps`);
            
            callbacks.onProgress('upload', {
              totalBytes,
              elapsed,
              speedMbps,
            });
            
            this.sendDataChannel({
              cmd: 'TEST_UPDATE',
              payload: { direction: 'upload', speed: speedMbps, bytes: totalBytes, elapsed, speedMbps },
            });
            
            lastUpdate = now;
          }
          
          // Check again shortly
          setTimeout(send, 5);
        };
        
        send();
      });
    };
    
    await sendLoop();
    
    const elapsed = (performance.now() - startTime) / 1000;
    const speedMbps = calcSpeedMbps(totalBytes, elapsed);
    this.log(`runSender done: ${(totalBytes / 1024 / 1024).toFixed(2)} MB, ${elapsed.toFixed(2)}s, ${speedMbps.toFixed(1)} Mbps`);
  }
  
  /**
   * Receiver: waits for data through data channel
   */
  private async runReceiver(
    _dc: RTCDataChannel,
    config: SpeedTestConfig,
    _callbacks: SpeedTestCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    this.log(`runReceiver: waiting for data`);
    
    // Reset receive state
    this.receiveStartTime = performance.now();
    this.receiveTotalBytes = 0;
    this.receiveLastUpdate = performance.now();
    this.receiveStopped = false;
    
    // Wait for test to complete or abort
    return new Promise((resolve) => {
      const checkEnd = () => {
        if (signal.aborted) {
          this.log('runReceiver: aborted');
          resolve();
          return;
        }
        
        // Check if we've been receiving for too long (timeout)
        const elapsed = (performance.now() - this.receiveStartTime) / 1000;
        if (elapsed > config.duration + 5) {
          this.log('runReceiver: timeout');
          resolve();
          return;
        }

        if (this.receiveStopped) {
          this.log('runReceiver: stopped by peer');
          resolve();
          return;
        }
        
        setTimeout(checkEnd, 100);
      };
      
      checkEnd();
    });
  }
  
  // =========================================================================
  // Test Cleanup
  // =========================================================================
  
  private abortTest(): void {
    this.log('abortTest');
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  
  private resetTest(): void {
    this.log('resetTest');
    this.abortTest();
    this.testState = 'idle';
    this.receiveTotalBytes = 0;
    this.receiveStartTime = 0;
    this.receiveLastUpdate = 0;
    this.receiveStopped = false;
    this.testCallbacks = null;
  }
  
  // =========================================================================
  // Debug Info
  // =========================================================================
  
  getDebugInfo(): any {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      pairingState: this._pairingState,
      testState: this.testState,
      partnerId: this.partnerId,
      partnerName: null,
      wsReadyState: this.signalingWs?.readyState,
      wsUrl: this.signalingWs?.url,
      hasPeerConnection: !!this.peerConnection,
      peerConnectionState: this.peerConnection?.connectionState,
      iceConnectionState: this.peerConnection?.iceConnectionState,
      hasDataChannel: !!this.dataChannel,
      dataChannelState: this.dataChannel?.readyState,
      bytesReceived: this.receiveTotalBytes,
      bytesSent: 0,
      recentMessages: this.messageLog.slice(-20).map(m => `[${m.time}] ${m.payload}`),
    };
  }
  
  private log(...args: any[]) {
    const time = new Date().toISOString().substring(11, 23);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a).substring(0, 200) : a).join(' ');
    this.messageLog.push({ time, dir: 'in', cmd: 'log', payload: msg });
    if (this.messageLog.length > 100) {
      this.messageLog.shift();
    }
    console.log(`[${time}] [WebRTC]`, ...args);
  }
  
  // =========================================================================
  // Lifecycle
  // =========================================================================
  
  destroy(): void {
    this.disconnect();
    this.resetTest();
  }
}
