import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  calcSpeedMbps,
  randomPayload,
  apiBase,
  setApiBase,
  clearApiBase,
  wsBase,
  DEFAULT_CONFIG,
} from '../src/lib/speedtest';

describe('calcSpeedMbps', () => {
  it('returns 0 for zero elapsed time', () => {
    expect(calcSpeedMbps(1000, 0)).toBe(0);
  });

  it('returns 0 for negative elapsed time', () => {
    expect(calcSpeedMbps(1000, -1)).toBe(0);
  });

  it('calculates correct speed for 1 MB in 1 second', () => {
    // 1 MB = 8,388,608 bits, 1 second → 8.388608 Mbps
    const result = calcSpeedMbps(1024 * 1024, 1);
    expect(result).toBeCloseTo(8.388608, 4);
  });

  it('calculates correct speed for 10 MB in 2 seconds', () => {
    // 10 MB = 83,886,080 bits, 2 seconds → 41.94304 Mbps
    const result = calcSpeedMbps(10 * 1024 * 1024, 2);
    expect(result).toBeCloseTo(41.94304, 4);
  });
});

describe('randomPayload', () => {
  it('returns buffer of correct size', () => {
    const payload = randomPayload(1024);
    expect(payload.length).toBe(1024);
  });

  it('returns deterministic content', () => {
    const a = randomPayload(100);
    const b = randomPayload(100);
    expect(a).toEqual(b);
  });

  it('fills with pseudo-random values', () => {
    const payload = randomPayload(10);
    // First byte: (0 * 7 + 13) & 0xff = 13
    expect(payload[0]).toBe(13);
    // Second byte: (1 * 7 + 13) & 0xff = 20
    expect(payload[1]).toBe(20);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_CONFIG.duration).toBe(10);
    expect(DEFAULT_CONFIG.parallel).toBe(1);
    expect(DEFAULT_CONFIG.packetSize).toBe(64 * 1024);
    expect(DEFAULT_CONFIG.mode).toBe('single');
  });
});

describe('apiBase / setApiBase / clearApiBase', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.SPEEDBOX_API_BASE;
    // Clear URL params
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
    delete window.SPEEDBOX_API_BASE;
    window.history.replaceState({}, '', '/');
  });

  it('returns empty string when nothing set', () => {
    expect(apiBase()).toBe('');
  });

  it('reads from URL param and persists', () => {
    window.history.replaceState({}, '', '/?api=http://192.168.1.1:8080');
    expect(apiBase()).toBe('http://192.168.1.1:8080');
    expect(localStorage.getItem('speedbox_api_base')).toBe('http://192.168.1.1:8080');
  });

  it('reads from localStorage', () => {
    localStorage.setItem('speedbox_api_base', 'http://10.0.0.1:3000');
    expect(apiBase()).toBe('http://10.0.0.1:3000');
  });

  it('reads from window global', () => {
    window.SPEEDBOX_API_BASE = 'http://localhost:9999';
    expect(apiBase()).toBe('http://localhost:9999');
  });

  it('URL param takes priority over localStorage', () => {
    localStorage.setItem('speedbox_api_base', 'http://old:1111');
    window.history.replaceState({}, '', '/?api=http://new:2222');
    expect(apiBase()).toBe('http://new:2222');
  });

  it('setApiBase persists to localStorage', () => {
    setApiBase('http://example.com:8080/');
    expect(localStorage.getItem('speedbox_api_base')).toBe('http://example.com:8080');
    expect(window.SPEEDBOX_API_BASE).toBe('http://example.com:8080');
  });

  it('clearApiBase removes stored value', () => {
    setApiBase('http://example.com:8080');
    clearApiBase();
    expect(localStorage.getItem('speedbox_api_base')).toBeNull();
    expect(window.SPEEDBOX_API_BASE).toBeUndefined();
  });

  it('strips trailing slash', () => {
    setApiBase('http://example.com:8080/');
    expect(apiBase()).toBe('http://example.com:8080');
  });
});

describe('wsBase', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.SPEEDBOX_API_BASE;
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
    delete window.SPEEDBOX_API_BASE;
    window.history.replaceState({}, '', '/');
  });

  it('converts http:// to ws://', () => {
    setApiBase('http://192.168.1.1:8080');
    expect(wsBase()).toBe('ws://192.168.1.1:8080');
  });

  it('converts https:// to wss://', () => {
    setApiBase('https://example.com:443');
    expect(wsBase()).toBe('wss://example.com:443');
  });
});
