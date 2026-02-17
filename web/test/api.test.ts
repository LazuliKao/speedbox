import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getInfo } from '../src/api';

describe('api', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getInfo fetches /info and returns text', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('speedbox 0.1.0'),
    });

    const info = await getInfo();
    expect(info).toBe('speedbox 0.1.0');
    expect(fetch).toHaveBeenCalledWith('/info');
  });

  it('getInfo throws on non-ok response', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(getInfo()).rejects.toThrow('info: 500');
  });

  it('uses SPEEDBOX_API_BASE when set', async () => {
    (globalThis as unknown as Record<string, unknown>).window = { SPEEDBOX_API_BASE: 'http://192.168.1.1:8080' };
    (globalThis as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('speedbox 0.1.0'),
    });

    const { getInfo: getInfo2 } = await import('../src/api');
    await getInfo2();
    expect(fetch).toHaveBeenCalledWith('http://192.168.1.1:8080/info');
  });
});
