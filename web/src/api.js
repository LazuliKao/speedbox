/**
 * Speedbox API client.
 *
 * Base URL resolution:
 *   1. window.SPEEDBOX_API_BASE (set by LuCI view for direct-access mode)
 *   2. Empty string (same-origin, works with vite proxy or uhttpd reverse proxy)
 */
const BASE = () => (typeof window !== 'undefined' && window.SPEEDBOX_API_BASE) || '';

/** GET /info → plain text "speedbox 0.1.0" */
export async function getInfo() {
  const res = await fetch(`${BASE()}/info`);
  if (!res.ok) throw new Error(`info: ${res.status}`);
  return res.text();
}

/**
 * GET /download — stream random bytes, reporting progress.
 * @param {(p: {totalBytes:number, elapsed:number, speedMbps:number}) => void} onProgress
 * @param {AbortSignal} signal
 */
export async function startDownload(onProgress, signal) {
  const res = await fetch(`${BASE()}/download`, { signal });
  if (!res.ok) throw new Error(`download: ${res.status}`);
  const reader = res.body.getReader();
  let totalBytes = 0;
  const t0 = performance.now();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    const elapsed = (performance.now() - t0) / 1000;
    const speedMbps = (totalBytes * 8) / (elapsed * 1_000_000);
    onProgress({ totalBytes, elapsed, speedMbps });
  }
  return totalBytes;
}

/**
 * POST /upload — send random payload, reporting progress via XHR.
 * @param {(p: {totalBytes:number, elapsed:number, speedMbps:number}) => void} onProgress
 * @param {AbortSignal} signal
 * @param {number} sizeMB  total megabytes to send (default 32)
 */
export function startUpload(onProgress, signal, sizeMB = 32) {
  return new Promise((resolve, reject) => {
    const totalSize = sizeMB * 1024 * 1024;

    // Build a pseudo-random blob (defeats compression)
    const chunkSize = 256 * 1024;
    const piece = new Uint8Array(chunkSize);
    for (let i = 0; i < piece.length; i++) piece[i] = (i * 7 + 13) & 0xff;
    const parts = [];
    for (let sent = 0; sent < totalSize; sent += chunkSize) {
      parts.push(piece.slice(0, Math.min(chunkSize, totalSize - sent)));
    }
    const blob = new Blob(parts);

    const xhr = new XMLHttpRequest();
    const t0 = performance.now();

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = (performance.now() - t0) / 1000;
      const speedMbps = (e.loaded * 8) / (elapsed * 1_000_000);
      onProgress({ totalBytes: e.loaded, elapsed, speedMbps });
    };

    xhr.onload = () => resolve(xhr.responseText);
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.ontimeout = () => reject(new Error('upload timeout'));

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.open('POST', `${BASE()}/upload`);
    xhr.send(blob);
  });
}
