/**
 * HTTP Speed Test Adapter.
 *
 * Download: GET /download?chunk_size=N (streaming, aborted after duration).
 * Upload: POST /upload with random blob (aborted after duration).
 * Parallel: Multiple concurrent fetch/XHR calls, speeds aggregated.
 * Continuous: Repeated rounds until stop() is called.
 */

import {
  type SpeedTestAdapter,
  type SpeedTestConfig,
  type SpeedTestCallbacks,
  type TestDirection,
  apiBase,
  randomPayload,
  calcSpeedMbps,
} from '../speedtest';

export class HttpAdapter implements SpeedTestAdapter {
  readonly name = 'HTTP';

  private abortController: AbortController | null = null;
  private running = false;

  start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    if (direction === 'download') {
      callbacks.onStateChange('downloading');
      return this.runDownload(config, callbacks, signal).then(() => {
        // Report interrupted if test was stopped before natural completion
        if (!this.running && signal.aborted) {
          callbacks.onStateChange('interrupted');
        } else {
          callbacks.onStateChange('done');
        }
      });
    } else {
      callbacks.onStateChange('uploading');
      return this.runUpload(config, callbacks, signal).then(() => {
        // Report interrupted if test was stopped before natural completion
        if (!this.running && signal.aborted) {
          callbacks.onStateChange('interrupted');
        } else {
          callbacks.onStateChange('done');
        }
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  destroy(): void {
    this.stop();
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  private async runDownload(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const isContinuous = config.mode === 'continuous';

    do {
      // Each round: run for `duration` seconds
      const roundAc = new AbortController();
      const combinedAbort = () => roundAc.abort();
      signal.addEventListener('abort', combinedAbort, { once: true });

      // Auto-stop round after duration (single mode)
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (!isContinuous) {
        timer = setTimeout(() => roundAc.abort(), config.duration * 1000);
      }

      try {
        await this.downloadRound(config, callbacks, roundAc);
      } catch {
        // AbortError is expected for timed rounds
      } finally {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', combinedAbort);
      }
    } while (isContinuous && this.running && !signal.aborted);
  }

  private async downloadRound(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    ac: AbortController
  ): Promise<void> {
    const base = apiBase();
    const url = `${base}/download?chunk_size=${config.packetSize}`;

    // Aggregate state across parallel streams
    const streamBytes = new Array(config.parallel).fill(0);
    const t0 = performance.now();

    const reportProgress = () => {
      const total = streamBytes.reduce((a: number, b: number) => a + b, 0);
      const elapsed = (performance.now() - t0) / 1000;
      callbacks.onProgress('download', {
        totalBytes: total,
        elapsed,
        speedMbps: calcSpeedMbps(total, elapsed),
      });
    };

    const workers = Array.from({ length: config.parallel }, (_, i) =>
      this.downloadWorker(url, ac.signal, i, streamBytes, reportProgress)
    );

    await Promise.allSettled(workers);
  }

  private async downloadWorker(
    url: string,
    signal: AbortSignal,
    index: number,
    streamBytes: number[],
    reportProgress: () => void
  ): Promise<void> {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`download: ${res.status}`);
    const reader = res.body!.getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBytes[index] += value.byteLength;
      reportProgress();
    }
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  private async runUpload(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const isContinuous = config.mode === 'continuous';

    do {
      const roundAc = new AbortController();
      const combinedAbort = () => roundAc.abort();
      signal.addEventListener('abort', combinedAbort, { once: true });

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (!isContinuous) {
        timer = setTimeout(() => roundAc.abort(), config.duration * 1000);
      }

      try {
        await this.uploadRound(config, callbacks, roundAc);
      } catch {
        // AbortError expected
      } finally {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', combinedAbort);
      }
    } while (isContinuous && this.running && !signal.aborted);
  }

  private async uploadRound(
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks,
    ac: AbortController
  ): Promise<void> {
    const streamBytes = new Array(config.parallel).fill(0);
    const t0 = performance.now();

    const reportProgress = () => {
      const total = streamBytes.reduce((a: number, b: number) => a + b, 0);
      const elapsed = (performance.now() - t0) / 1000;
      callbacks.onProgress('upload', {
        totalBytes: total,
        elapsed,
        speedMbps: calcSpeedMbps(total, elapsed),
      });
    };

    const workers = Array.from({ length: config.parallel }, (_, i) =>
      this.uploadWorker(config.packetSize, ac, i, streamBytes, reportProgress)
    );

    await Promise.allSettled(workers);
  }

  private uploadWorker(
    packetSize: number,
    ac: AbortController,
    index: number,
    streamBytes: number[],
    reportProgress: () => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let totalUploaded = 0;
      const blob = new Blob([randomPayload(packetSize) as BlobPart]);

      const uploadNext = () => {
        if (ac.signal.aborted) {
          resolve();
          return;
        }

        const xhr = new XMLHttpRequest();
        const startLoaded = totalUploaded;

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          streamBytes[index] = startLoaded + e.loaded;
          totalUploaded = startLoaded + e.loaded;
          reportProgress();
        };

        xhr.onload = () => {
          if (ac.signal.aborted) {
            resolve();
            return;
          }
          totalUploaded = startLoaded + packetSize;
          streamBytes[index] = totalUploaded;
          reportProgress();
          uploadNext();
        };

        xhr.onerror = () => reject(new Error('upload failed'));
        xhr.ontimeout = () => reject(new Error('upload timeout'));
        xhr.onabort = () => resolve();

        ac.signal.addEventListener('abort', () => xhr.abort(), { once: true });

        xhr.open('POST', `${apiBase()}/upload`);
        xhr.send(blob.slice());
      };

      uploadNext();
    });
  }
}
