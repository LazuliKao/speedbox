/**
 * WebRTC Speed Test Adapter (P2P, LAN only).
 *
 * Architecture:
 *   - Two browsers connect via Speedbox signaling server (/ws/signal).
 *   - Host creates offer, Client answers.
 *   - Data is transferred over RTCDataChannel (UDP, unordered, unreliable for max throughput).
 *   - No TURN server — LAN only.
 *
 * Signaling Protocol (text over WebSocket):
 *   JOIN <room_id>  → join/create room
 *   SIGNAL <json>   → forward SDP/ICE to peer
 *   LEAVE           → leave room
 *   LIST            → get available rooms
 *
 * DataChannel Protocol:
 *   - Direction negotiated out-of-band (both sides know their role).
 *   - Download (from host's perspective): host sends, client receives.
 *   - Upload (from host's perspective): client sends, host receives.
 *   - "START" text message begins the transfer.
 *   - "STOP" text message ends it.
 */

import {
  type SpeedTestAdapter,
  type SpeedTestConfig,
  type SpeedTestCallbacks,
  type TestDirection,
  wsBase,
  randomPayload,
  calcSpeedMbps,
} from '../speedtest';

export type WebRtcRole = 'host' | 'client';

export interface WebRtcOptions {
  /** Room ID for signaling. */
  roomId: string;
}

export class WebRtcAdapter implements SpeedTestAdapter {
  readonly name = 'WebRTC';

  private signalingWs: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private role: WebRtcRole | null = null;
  private running = false;
  private stopResolve: (() => void) | null = null;
  private options: WebRtcOptions;

  constructor(options: WebRtcOptions) {
    this.options = options;
  }

  async start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    this.running = true;
    callbacks.onStateChange(
      direction === 'download' ? 'downloading' : 'uploading'
    );

    try {
      await this.connect();
      await this.runTest(direction, config, callbacks);
    } catch (err) {
      callbacks.onError(`WebRTC: ${(err as Error).message}`);
      callbacks.onStateChange('error');
    }
  }

  stop(): void {
    this.running = false;
    if (this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
    }
    this.cleanup();
  }

  destroy(): void {
    this.stop();
  }

  // -------------------------------------------------------------------------
  // Signaling
  // -------------------------------------------------------------------------

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${wsBase()}/ws/signal`;
      const ws = new WebSocket(url);
      this.signalingWs = ws;

      ws.onopen = () => {
        ws.send(`JOIN ${this.options.roomId}`);
      };

      ws.onmessage = (e) => {
        const msg = e.data as string;

        if (msg.startsWith('JOINED ')) {
          this.role = msg.split(' ')[1] as WebRtcRole;
          this.setupPeerConnection(resolve, reject);
        } else if (msg.startsWith('PEER_JOINED')) {
          // Host: peer arrived, create offer
          if (this.role === 'host') {
            this.createOffer();
          }
        } else if (msg.startsWith('SIGNAL ')) {
          const payload = msg.slice(7);
          this.handleSignal(payload, resolve);
        } else if (msg.startsWith('ERROR ')) {
          reject(new Error(msg.slice(6)));
        }
      };

      ws.onerror = () => reject(new Error('signaling connection failed'));
      ws.onclose = () => {
        // Expected on cleanup
      };
    });
  }

  private setupPeerConnection(
    resolve: () => void,
    _reject: (err: Error) => void
  ): void {
    const pc = new RTCPeerConnection({
      iceServers: [], // LAN only, no STUN/TURN
    });
    this.peerConnection = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({
          type: 'candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    if (this.role === 'host') {
      // Host creates the data channel
      const dc = pc.createDataChannel('speedtest', {
        ordered: false,
        maxRetransmits: 0, // Unreliable for max throughput
      });
      dc.binaryType = 'arraybuffer';
      this.dataChannel = dc;

      dc.onopen = () => resolve();
    } else {
      // Client waits for the data channel
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dc.binaryType = 'arraybuffer';
        this.dataChannel = dc;
        dc.onopen = () => resolve();
      };
    }
  }

  private async createOffer(): Promise<void> {
    const pc = this.peerConnection!;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: offer.sdp });
  }

  private async handleSignal(
    payload: string,
    resolve: () => void
  ): Promise<void> {
    const pc = this.peerConnection!;
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }

    if (data.type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', sdp: answer.sdp });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    } else if (data.type === 'candidate') {
      await pc.addIceCandidate(data.candidate);
    }

    // resolve is called when DataChannel opens, not here
    void resolve;
  }

  private sendSignal(data: object): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(`SIGNAL ${JSON.stringify(data)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Test Execution
  // -------------------------------------------------------------------------

  private async runTest(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    const dc = this.dataChannel!;
    // P2P requires opposite roles: when both click same button, one sends, one receives.
    const isSender =
      (direction === 'upload' && this.role === 'host') ||
      (direction === 'download' && this.role === 'client');

    const isContinuous = config.mode === 'continuous';

    do {
      if (isSender) {
        await this.sendData(dc, config, direction, callbacks);
      } else {
        await this.receiveData(dc, config, direction, callbacks);
      }
    } while (isContinuous && this.running);
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

      // Auto-stop after duration (single mode)
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          dc.send('STOP');
          resolve();
        }, config.duration * 1000);
      }

      this.stopResolve = () => {
        if (timer) clearTimeout(timer);
        try {
          dc.send('STOP');
        } catch {
          // channel may be closed
        }
        resolve();
      };

      dc.send('START');

      const sendLoop = () => {
        if (!this.running && config.mode === 'continuous') {
          resolve();
          return;
        }

        // Backpressure: respect bufferedAmount
        while (
          dc.readyState === 'open' &&
          dc.bufferedAmount < config.packetSize * 8
        ) {
          dc.send(payload as any);
          totalBytes += payload.byteLength;

          const elapsed = (performance.now() - t0) / 1000;
          callbacks.onProgress(direction, {
            totalBytes,
            elapsed,
            speedMbps: calcSpeedMbps(totalBytes, elapsed),
          });
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

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          resolve();
        }, config.duration * 1000);
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
          } else if (e.data === 'STOP') {
            if (timer) clearTimeout(timer);
            resolve();
          }
          return;
        }

        if (!started) return;

        totalBytes += (e.data as ArrayBuffer).byteLength;
        const elapsed = (performance.now() - t0) / 1000;
        callbacks.onProgress(direction, {
          totalBytes,
          elapsed,
          speedMbps: calcSpeedMbps(totalBytes, elapsed),
        });
      };
    });
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private cleanup(): void {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // ignore
      }
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.signalingWs) {
      try {
        this.signalingWs.send('LEAVE');
        this.signalingWs.close();
      } catch {
        // ignore
      }
      this.signalingWs = null;
    }

    this.role = null;
  }

  // -------------------------------------------------------------------------
  // Static helpers for room management
  // -------------------------------------------------------------------------

  /** List available rooms from the signaling server. */
  static listRooms(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const url = `${wsBase()}/ws/signal`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        ws.send('LIST');
      };

      ws.onmessage = (e) => {
        const msg = e.data as string;
        if (msg.startsWith('ROOMS ')) {
          try {
            const rooms = JSON.parse(msg.slice(6)) as string[];
            resolve(rooms);
          } catch {
            resolve([]);
          }
        }
        ws.close();
      };

      ws.onerror = () => {
        reject(new Error('failed to list rooms'));
        ws.close();
      };

      setTimeout(() => {
        ws.close();
        resolve([]);
      }, 3000);
    });
  }
}
