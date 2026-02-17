/**
 * WebSocket Speed Test Adapter.
 *
 * Protocol (matches backend src/protocol/ws.rs):
 *   1. Connect to ws://host/ws/speed
 *   2. Send text command: "download" or "upload"
 *   3. Download: server floods binary frames; client measures throughput.
 *   4. Upload: client floods binary frames; server counts and echoes back.
 *   5. Close socket to stop.
 *
 * Parallel: Multiple WebSocket connections.
 * Continuous: Re-open connections after each round until stop().
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

export class WebSocketAdapter implements SpeedTestAdapter {
  readonly name = 'WebSocket';

  private sockets: WebSocket[] = [];
  private running = false;
  private stopResolve: (() => void) | null = null;

  start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    this.running = true;

    if (direction === 'download') {
      callbacks.onStateChange('downloading');
      return this.runDownload(config, callbacks);
    } else {
      callbacks.onStateChange('uploading');
      return this.runUpload(config, callbacks);
    }
  }

  stop(): void {
    this.running = false;
    this.closeSockets();
    if (this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
    }
  }

  destroy(): void {
    this.stop();
  }

  private closeSockets(): void {
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.sockets = [];
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  private async runDownload(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    const isContinuous = config.mode === 'continuous';

    do {
      await this.downloadRound(config, callbacks);
    } while (isContinuous && this.running);
  }

  private downloadRound(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    return new Promise((resolve) => {
      const streamBytes = new Array(config.parallel).fill(0);
      const t0 = performance.now();
      let finished = 0;

      const reportProgress = () => {
        const total = streamBytes.reduce((a: number, b: number) => a + b, 0);
        const elapsed = (performance.now() - t0) / 1000;
        callbacks.onProgress('download', {
          totalBytes: total,
          elapsed,
          speedMbps: calcSpeedMbps(total, elapsed),
        });
      };

      const onDone = () => {
        finished++;
        if (finished >= config.parallel) {
          resolve();
        }
      };

      // Auto-close after duration (single mode)
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          this.closeSockets();
        }, config.duration * 1000);
      }

      // Store resolve for stop() in continuous mode
      this.stopResolve = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      for (let i = 0; i < config.parallel; i++) {
        const url = `${wsBase()}/ws/speed`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.sockets.push(ws);

        ws.onopen = () => {
          ws.send('download');
        };

        ws.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            streamBytes[i] += e.data.byteLength;
            reportProgress();
          }
        };

        ws.onclose = () => onDone();
        ws.onerror = () => onDone();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  private async runUpload(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    const isContinuous = config.mode === 'continuous';

    do {
      await this.uploadRound(config, callbacks);
    } while (isContinuous && this.running);
  }

  private uploadRound(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    return new Promise((resolve) => {
      const payload = randomPayload(config.packetSize);
      const streamBytes = new Array(config.parallel).fill(0);
      const t0 = performance.now();
      let finished = 0;

      const reportProgress = () => {
        const total = streamBytes.reduce((a: number, b: number) => a + b, 0);
        const elapsed = (performance.now() - t0) / 1000;
        callbacks.onProgress('upload', {
          totalBytes: total,
          elapsed,
          speedMbps: calcSpeedMbps(total, elapsed),
        });
      };

      const onDone = () => {
        finished++;
        if (finished >= config.parallel) {
          resolve();
        }
      };

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (config.mode === 'single') {
        timer = setTimeout(() => {
          this.closeSockets();
        }, config.duration * 1000);
      }

      this.stopResolve = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      for (let i = 0; i < config.parallel; i++) {
        const url = `${wsBase()}/ws/speed`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.sockets.push(ws);

        ws.onopen = () => {
          ws.send('upload');
          // Flood binary frames
          const sendLoop = () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            // Backpressure: only send when buffer is low
            while (
              ws.readyState === WebSocket.OPEN &&
              ws.bufferedAmount < config.packetSize * 4
            ) {
              ws.send(payload);
              streamBytes[i] += payload.byteLength;
              reportProgress();
            }
            if (ws.readyState === WebSocket.OPEN) {
              setTimeout(sendLoop, 1);
            }
          };
          sendLoop();
        };

        ws.onclose = () => onDone();
        ws.onerror = () => onDone();
      }
    });
  }
}
