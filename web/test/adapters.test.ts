import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpeedTestConfig, SpeedTestCallbacks, TestState } from '../src/lib/speedtest';

// ---------------------------------------------------------------------------
// Mock setup — must come before adapter imports
// ---------------------------------------------------------------------------

const TEST_API_BASE = 'http://test-host:8080';
const TEST_WS_BASE = 'ws://test-host:8080';

let mockPerformanceNow = 0;

vi.mock('../src/lib/speedtest', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/speedtest')>();
  return {
    ...orig,
    apiBase: () => TEST_API_BASE,
    wsBase: () => TEST_WS_BASE,
  };
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SpeedTestConfig>): SpeedTestConfig {
  return {
    duration: 2,
    parallel: 1,
    packetSize: 1024,
    mode: 'single',
    ...overrides,
  };
}

function makeCallbacks(): SpeedTestCallbacks & {
  progressCalls: Array<{ direction: string; totalBytes: number }>;
  stateCalls: TestState[];
} {
  const calls = {
    progressCalls: [] as Array<{ direction: string; totalBytes: number }>,
    stateCalls: [] as TestState[],
  };

  return {
    onProgress: (direction, progress) => {
      calls.progressCalls.push({ direction, totalBytes: progress.totalBytes });
    },
    onStateChange: (state) => {
      calls.stateCalls.push(state);
    },
    onError: vi.fn(),
    ...calls,
  };
}

// ===========================================================================
// HttpAdapter
// ===========================================================================

describe('HttpAdapter', () => {
  let HttpAdapter: typeof import('../src/lib/adapters/http').HttpAdapter;
  let adapter: InstanceType<typeof HttpAdapter>;
  let origFetch: typeof globalThis.fetch;
  let origXHR: typeof globalThis.XMLHttpRequest;

  beforeEach(async () => {
    mockPerformanceNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockPerformanceNow);

    origFetch = globalThis.fetch;
    origXHR = globalThis.XMLHttpRequest;

    const mod = await import('../src/lib/adapters/http');
    HttpAdapter = mod.HttpAdapter;
    adapter = new HttpAdapter();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    globalThis.XMLHttpRequest = origXHR;
    vi.restoreAllMocks();
  });

  it('has name property "HTTP"', () => {
    expect(adapter.name).toBe('HTTP');
  });

  it('stop() is safe to call without active test', () => {
    adapter.stop();
    expect(() => adapter.stop()).not.toThrow();
  });

  it('destroy() calls stop() without error', () => {
    adapter.destroy();
    expect(() => adapter.destroy()).not.toThrow();
  });

  // ----- Download ----------------------------------------------------------

  describe('download', () => {
    it('streams data from fetch and calls onProgress + onStateChange', async () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);
      let readCount = 0;

      const reader = {
        read: vi.fn(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: chunk1 };
          }
          if (readCount === 1) {
            readCount++;
            return { done: false, value: chunk2 };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        body: { getReader: () => reader },
      })) as unknown as typeof fetch;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1 });

      await adapter.start('download', config, cb);

      expect(cb.stateCalls).toContain('downloading');
      expect(cb.stateCalls).toContain('done');
      expect(cb.progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(cb.progressCalls.every((p) => p.direction === 'download')).toBe(true);

      // Total bytes should accumulate (chunk1=3 + chunk2=3 = 6)
      const lastProgress = cb.progressCalls[cb.progressCalls.length - 1];
      expect(lastProgress.totalBytes).toBe(6);
    });

    it('abort signal is triggered when stop() is called mid-download', async () => {
      let fetchAbortSignal: AbortSignal | undefined;

      globalThis.fetch = vi.fn(async (_url, opts) => {
        fetchAbortSignal = (opts as RequestInit).signal as AbortSignal;
        const signal = fetchAbortSignal;
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn(() => new Promise((_resolve, reject) => {
                // Reject with AbortError when the abort signal fires
                const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
                if (signal?.aborted) { onAbort(); return; }
                signal?.addEventListener('abort', onAbort, { once: true });
              })),
              releaseLock: vi.fn(),
            }),
          },
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 10 });

      const startPromise = adapter.start('download', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      adapter.stop();
      await startPromise;

      expect(fetchAbortSignal?.aborted).toBe(true);
      expect(cb.stateCalls).toContain('downloading');
      expect(cb.stateCalls).toContain('interrupted');
    });

    it('calls fetch with correct URL including chunk_size', async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn(async () => ({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          }),
        },
      })) as unknown as typeof fetch;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1, packetSize: 4096 });

      await adapter.start('download', config, cb);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${TEST_API_BASE}/download?chunk_size=4096`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  // ----- Upload ------------------------------------------------------------

  describe('upload', () => {
    it('creates XMLHttpRequest and sends payload, calls onProgress', async () => {
      const openSpy = vi.fn();
      const sendSpy = vi.fn();
      const xhrInstances: unknown[] = [];

      class MockXHR {
        upload = {
          onprogress: null as ((e: ProgressEvent) => void) | null,
        };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        ontimeout: (() => void) | null = null;
        onabort: (() => void) | null = null;
        open = openSpy;
        send = sendSpy;
        abort = vi.fn(() => {
          if (this.onabort) this.onabort();
        });

        constructor() {
          xhrInstances.push(this);
        }
      }

      globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1 });

      const startPromise = adapter.start('upload', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      // Trigger onprogress + onload on each XHR created by the adapter
      // Snapshot the array length first to avoid processing recursively-created ones
      const count = xhrInstances.length;
      for (let idx = 0; idx < count; idx++) {
        const xhr = xhrInstances[idx] as {
          onload: (() => void) | null;
          upload: { onprogress: ((e: ProgressEvent) => void) | null };
        };
        if (xhr.upload.onprogress) {
          xhr.upload.onprogress({
            lengthComputable: true,
            loaded: 1024,
          } as unknown as ProgressEvent);
        }
        if (xhr.onload) xhr.onload();
      }

      // Stop to end the upload loop
      adapter.stop();
      await startPromise;

      expect(cb.stateCalls).toContain('uploading');
      expect(openSpy).toHaveBeenCalledWith('POST', `${TEST_API_BASE}/upload`);
      expect(sendSpy).toHaveBeenCalled();
    });

    it('abort via stop() sends abort to XHR', async () => {
      const xhrInstances: unknown[] = [];

      class MockXHR {
        upload = { onprogress: null as null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        ontimeout: (() => void) | null = null;
        onabort: (() => void) | null = null;
        abort = vi.fn(() => {
          if (this.onabort) this.onabort();
        });
        open = vi.fn();
        send = vi.fn();

        constructor() {
          xhrInstances.push(this);
        }
      }

      globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 10 });

      const startPromise = adapter.start('upload', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      adapter.stop();
      await startPromise;

      // Check the tracked instance's abort was called
      const xhr = xhrInstances[0] as { abort: { toHaveBeenCalled: () => void } };
      expect(xhr.abort).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// WebSocketAdapter
// ===========================================================================

describe('WebSocketAdapter', () => {
  let WebSocketAdapter: typeof import('../src/lib/adapters/websocket').WebSocketAdapter;
  let adapter: InstanceType<typeof WebSocketAdapter>;
  let origWebSocket: typeof globalThis.WebSocket;

  beforeEach(async () => {
    mockPerformanceNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockPerformanceNow);

    origWebSocket = globalThis.WebSocket;

    const mod = await import('../src/lib/adapters/websocket');
    WebSocketAdapter = mod.WebSocketAdapter;
    adapter = new WebSocketAdapter();
  });

  afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    vi.restoreAllMocks();
  });

  it('has name property "WebSocket"', () => {
    expect(adapter.name).toBe('WebSocket');
  });

  it('stop() is safe to call without active test', () => {
    adapter.stop();
    expect(() => adapter.stop()).not.toThrow();
  });

  it('destroy() calls stop()', () => {
    adapter.destroy();
    expect(() => adapter.destroy()).not.toThrow();
  });

  // ----- Download ----------------------------------------------------------

  describe('download', () => {
    it('connects WebSocket, sends "download" command, receives binary frames', async () => {
      const instances: MockWS[] = [];

      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;

        binaryType = '';
        readyState = MockWS.OPEN;
        bufferedAmount = 0;

        onopen: (() => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;

        send = vi.fn();
        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(public url: string) {
          instances.push(this);
        }

        _simulateBinary(data: ArrayBuffer) {
          if (this.onmessage) {
            this.onmessage({ data } as unknown as MessageEvent);
          }
        }
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1 });

      const startPromise = adapter.start('download', config, cb);
      await vi.waitFor(() => expect(instances.length).toBe(1));

      const ws = instances[0];

      // Simulate onopen → adapter should send 'download'
      if (ws.onopen) ws.onopen();
      expect(ws.send).toHaveBeenCalledWith('download');

      // Simulate receiving binary frames
      const frame1 = new ArrayBuffer(100);
      const frame2 = new ArrayBuffer(200);
      ws._simulateBinary(frame1);
      ws._simulateBinary(frame2);

      // Close to end the round
      ws.close();
      await startPromise;

      expect(cb.stateCalls).toContain('downloading');
      expect(cb.stateCalls).toContain('done');
      expect(cb.progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(cb.progressCalls[cb.progressCalls.length - 1].totalBytes).toBe(300);
    });

    it('stop() mid-download triggers interrupted state', async () => {
      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;
        static CONNECTING = 0;

        binaryType = '';
        readyState = MockWS.CONNECTING;
        bufferedAmount = 0;
        onopen: (() => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        send = vi.fn();
        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(_url: string) {}
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 10 });

      const startPromise = adapter.start('download', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      adapter.stop();
      await startPromise;

      expect(cb.stateCalls).toContain('downloading');
      expect(cb.stateCalls).toContain('interrupted');
    });

    it('opens WebSocket to wsBase() + /ws/speed', async () => {
      let capturedUrl = '';

      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;

        binaryType = '';
        readyState = MockWS.OPEN;
        bufferedAmount = 0;
        onopen: (() => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        send = vi.fn();
        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(url: string) {
          capturedUrl = url;
          // Immediately trigger onopen
          setTimeout(() => {
            if (this.onopen) this.onopen();
          }, 0);
        }
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1, mode: 'continuous' });

      const startPromise = adapter.start('download', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      expect(capturedUrl).toBe(`${TEST_WS_BASE}/ws/speed`);

      adapter.stop();
      await startPromise;
    });
  });

  // ----- Upload ------------------------------------------------------------

  describe('upload', () => {
    it('connects WebSocket, sends "upload", then floods binary frames', async () => {
      const instances: MockWS[] = [];

      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;

        binaryType = '';
        readyState = MockWS.OPEN;
        // bufferedAmount must INCREMENT on send so the while loop in sendLoop exits.
        // The adapter's sendLoop: while (ws.readyState === OPEN && ws.bufferedAmount < packetSize * 4) ws.send(payload);
        // After while exits, setTimeout(sendLoop, 1) is scheduled. The next call checks readyState.
        bufferedAmount = 0;

        onopen: (() => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;

        send = vi.fn((_data: string | ArrayBuffer) => {
          // Increment bufferedAmount (simulates data queued for network)
          this.bufferedAmount += 1024;
        });

        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(public url: string) {
          instances.push(this);
        }
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1, packetSize: 1024 });

      const startPromise = adapter.start('upload', config, cb);
      await vi.waitFor(() => expect(instances.length).toBe(1));

      const ws = instances[0];

      // Trigger onopen — adapter sends 'upload' then starts sendLoop
      if (ws.onopen) ws.onopen();
      expect(ws.send).toHaveBeenCalledWith('upload');

      // The sendLoop runs synchronously: while (bufferedAmount < 4096) send;
      // With increment of 1024, it sends 4 times then exits while.
      // Then setTimeout(sendLoop, 1) is scheduled.
      // Close the socket so the next sendLoop sees CLOSED and stops.
      ws.close();
      await startPromise;

      expect(cb.stateCalls).toContain('uploading');
      expect(cb.stateCalls).toContain('done');
      expect(cb.progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(cb.progressCalls[0].direction).toBe('upload');
    });

    it('stop() mid-upload closes sockets and resolves', async () => {
      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;
        static CONNECTING = 0;

        binaryType = '';
        readyState = MockWS.CONNECTING;
        bufferedAmount = 0;
        onopen: (() => void) | null = null;
        onmessage: null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        send = vi.fn();
        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(_url: string) {}
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 10 });

      const startPromise = adapter.start('upload', config, cb);
      await new Promise((r) => setTimeout(r, 10));

      adapter.stop();
      await startPromise;

      expect(cb.stateCalls).toContain('uploading');
      expect(cb.stateCalls).toContain('interrupted');
    });

    it('sends binary payload (not text) in upload flood', async () => {
      const sendCalls: Array<string | ArrayBuffer | ArrayBufferView> = [];
      const instances: MockWS[] = [];

      class MockWS {
        static OPEN = 1;
        static CLOSED = 3;

        binaryType = '';
        readyState = MockWS.OPEN;
        bufferedAmount = 0;
        onopen: (() => void) | null = null;
        onmessage: null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;

        send = vi.fn((data: string | ArrayBuffer) => {
          sendCalls.push(data);
          this.bufferedAmount += 1024;
        });

        close = vi.fn(() => {
          this.readyState = MockWS.CLOSED;
          if (this.onclose) this.onclose();
        });

        constructor(_url: string) {
          instances.push(this);
          // Auto-fire onopen like a real WebSocket
          queueMicrotask(() => {
            if (this.onopen) this.onopen();
          });
        }
      }

      globalThis.WebSocket = MockWS as unknown as typeof WebSocket;

      const cb = makeCallbacks();
      const config = makeConfig({ duration: 1, packetSize: 1024 });

      const startPromise = adapter.start('upload', config, cb);
      // Wait for onopen to fire and sendLoop to run
      await new Promise((r) => setTimeout(r, 10));

      adapter.stop();
      await startPromise;

      // First send should be the 'upload' text command
      const textCommands = sendCalls.filter((c): c is string => typeof c === 'string');
      expect(textCommands).toContain('upload');

      // Remaining sends should be binary (Uint8Array from randomPayload)
      const binarySends = sendCalls.filter((c) => c instanceof Uint8Array || ArrayBuffer.isView(c));
      expect(binarySends.length).toBeGreaterThanOrEqual(1);
    });
  });
});
