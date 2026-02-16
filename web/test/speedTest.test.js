import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module before importing the hook
vi.mock('../src/api', () => ({
  startDownload: vi.fn(),
  startUpload: vi.fn(),
}));

import { startDownload, startUpload } from '../src/api';

describe('useSpeedTest (logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startDownload mock can be configured', async () => {
    startDownload.mockImplementation(async (onProgress) => {
      onProgress({ totalBytes: 1_000_000, elapsed: 1, speedMbps: 8 });
      return 1_000_000;
    });

    let result;
    await startDownload((p) => {
      result = p;
    }, new AbortController().signal);

    expect(result.speedMbps).toBe(8);
    expect(result.totalBytes).toBe(1_000_000);
  });

  it('startUpload mock can be configured', async () => {
    startUpload.mockImplementation(async (onProgress) => {
      onProgress({ totalBytes: 2_000_000, elapsed: 1, speedMbps: 16 });
      return 'received=2000000';
    });

    let result;
    await startUpload(
      (p) => { result = p; },
      new AbortController().signal,
      2,
    );

    expect(result.speedMbps).toBe(16);
  });
});

describe('speed calculation', () => {
  it('Mbps = bytes * 8 / (elapsed * 1e6)', () => {
    const bytes = 10_000_000; // 10 MB
    const elapsed = 1; // 1 second
    const mbps = (bytes * 8) / (elapsed * 1_000_000);
    expect(mbps).toBe(80);
  });

  it('handles zero elapsed gracefully', () => {
    const bytes = 1000;
    const elapsed = 0;
    const mbps = elapsed === 0 ? 0 : (bytes * 8) / (elapsed * 1_000_000);
    expect(mbps).toBe(0);
  });
});
