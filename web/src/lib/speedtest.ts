/**
 * SpeedTestAdapter — unified interface for all speed test protocols.
 *
 * Implementations: HttpAdapter, WebSocketAdapter, WebRtcAdapter.
 * Each adapter is self-contained and handles its own connection lifecycle.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Real-time progress report from an active test. */
export interface SpeedProgress {
  /** Total bytes transferred so far. */
  totalBytes: number;
  /** Seconds since test started. */
  elapsed: number;
  /** Current speed in Megabits per second. */
  speedMbps: number;
}

/** Time-series data point for charts. */
export interface HistoryPoint {
  /** Seconds since test start. */
  t: number;
  /** Speed in Mbps at this point. */
  v: number;
}

/** Test direction. */
export type TestDirection = 'download' | 'upload';

/** Test mode. */
export type TestMode = 'single' | 'continuous';

/** Overall test lifecycle state. */
export type TestState =
  | 'idle'
  | 'downloading'
  | 'uploading'
  | 'done'
  | 'error';

/** Configuration passed to every adapter. */
export interface SpeedTestConfig {
  /** Test duration in seconds (only for 'single' mode). */
  duration: number;
  /** Number of parallel streams / connections. */
  parallel: number;
  /** Chunk/packet size in bytes (used for download chunk_size, upload blob size, WS frame size). */
  packetSize: number;
  /** Test mode: 'single' runs once, 'continuous' loops until stopped. */
  mode: TestMode;
}

/** Default configuration. */
export const DEFAULT_CONFIG: SpeedTestConfig = {
  duration: 10,
  parallel: 1,
  packetSize: 64 * 1024,
  mode: 'single',
};

/** Callbacks that the adapter invokes during a test. */
export interface SpeedTestCallbacks {
  onProgress: (direction: TestDirection, progress: SpeedProgress) => void;
  onStateChange: (state: TestState) => void;
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

/**
 * Each protocol implements this interface.
 * The adapter is responsible for managing its own connections and cleanup.
 */
export interface SpeedTestAdapter {
  /** Human-readable protocol name (e.g. "HTTP", "WebSocket", "WebRTC"). */
  readonly name: string;

  /**
   * Start a speed test in the given direction.
   * For 'single' mode, the test runs for `config.duration` seconds then resolves.
   * For 'continuous' mode, the test runs until `stop()` is called.
   */
  start(
    direction: TestDirection,
    config: SpeedTestConfig,
    callbacks: SpeedTestCallbacks
  ): Promise<void>;

  /** Stop the current test. Safe to call when idle. */
  stop(): void;

  /** Release all resources (connections, buffers). */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the API base URL. */
export function apiBase(): string {
  return (
    (typeof window !== 'undefined' && (window as any).SPEEDBOX_API_BASE) || ''
  );
}

/** Build a pseudo-random Uint8Array that defeats compression. */
export function randomPayload(sizeBytes: number): Uint8Array {
  const buf = new Uint8Array(sizeBytes);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (i * 7 + 13) & 0xff;
  }
  return buf;
}

/** Calculate speed in Mbps from bytes and elapsed seconds. */
export function calcSpeedMbps(bytes: number, elapsedSec: number): number {
  if (elapsedSec <= 0) return 0;
  return (bytes * 8) / (elapsedSec * 1_000_000);
}

/** Convert an HTTP base URL to a WebSocket URL. */
export function wsBase(): string {
  const base = apiBase();
  if (base.startsWith('http://')) return base.replace('http://', 'ws://');
  if (base.startsWith('https://')) return base.replace('https://', 'wss://');
  // Same-origin: derive from current page location
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${base}`;
}
