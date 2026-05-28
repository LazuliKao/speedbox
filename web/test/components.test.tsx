import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { AdvancedSettings } from '../src/components/AdvancedSettings';
import { ProtocolSelector } from '../src/components/ProtocolSelector';
import { BackendConfig } from '../src/components/BackendConfig';
import type { SpeedTestConfig } from '../src/lib/speedtest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderToContainer(vnode: preact.VNode) {
  const container = document.createElement('div');
  act(() => {
    render(vnode, container);
  });
  return container;
}

/** Click an element by selector (avoids TS Element vs HTMLElement issue) */
function click(el: Element | DocumentFragment, selector: string) {
  (el.querySelector(selector)! as HTMLElement).click();
}

const DEFAULT_CONFIG: SpeedTestConfig = {
  duration: 10,
  parallel: 1,
  packetSize: 64 * 1024,
  mode: 'single',
};

// ---------------------------------------------------------------------------
// AdvancedSettings
// ---------------------------------------------------------------------------

describe('AdvancedSettings', () => {
  it('renders toggle button with label', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    const toggle = el.querySelector('.advanced-settings__toggle');
    expect(toggle).toBeTruthy();
    expect(toggle!.textContent).toContain('Advanced Settings');
  });

  it('hides body when collapsed (default)', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    expect(el.querySelector('.advanced-settings__body')).toBeNull();
  });

  it('shows body after toggle click', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });
    expect(el.querySelector('.advanced-settings__body')).toBeTruthy();
  });

  it('hides body after second toggle click', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });
    act(() => {
      click(el, '.advanced-settings__toggle');
    });
    expect(el.querySelector('.advanced-settings__body')).toBeNull();
  });

  it('renders all four controls when expanded', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    // Duration — number input
    expect(el.querySelector('input[type="number"][min="1"]')).toBeTruthy();
    // Packet size — select
    expect(el.querySelector('select')).toBeTruthy();
    // Parallel streams — number input
    expect(el.querySelector('input[type="number"][max="32"]')).toBeTruthy();
    // Mode toggle — checkbox
    expect(el.querySelector('input[type="checkbox"]')).toBeTruthy();
  });

  it('displays current config values', () => {
    const config: SpeedTestConfig = {
      duration: 30,
      parallel: 4,
      packetSize: 128 * 1024,
      mode: 'continuous',
    };
    const el = renderToContainer(
      <AdvancedSettings config={config} onChange={() => {}} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const select = el.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe(String(128 * 1024));
  });

  it('calls onChange when duration changes', () => {
    const onChange = vi.fn();
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={onChange} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const input = el.querySelector('input[type="number"][min="1"]') as HTMLInputElement;
    act(() => {
      input.value = '20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].duration).toBe(20);
  });

  it('calls onChange when parallel changes', () => {
    const onChange = vi.fn();
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={onChange} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const input = el.querySelector('input[type="number"][max="32"]') as HTMLInputElement;
    act(() => {
      input.value = '8';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].parallel).toBe(8);
  });

  it('calls onChange when packet size changes', () => {
    const onChange = vi.fn();
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={onChange} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const select = el.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = String(256 * 1024);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].packetSize).toBe(256 * 1024);
  });

  it('calls onChange with continuous mode when checkbox checked', () => {
    const onChange = vi.fn();
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={onChange} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].mode).toBe('continuous');
  });

  it('disables toggle button when disabled prop is true', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} disabled />,
    );
    const toggle = el.querySelector('.advanced-settings__toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it('does not expand when disabled prop is true', () => {
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} disabled />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });
    // Body should not appear because the toggle button is disabled
    expect(el.querySelector('.advanced-settings__body')).toBeNull();
  });

  it('passes disabled to all inner controls when expanded', () => {
    // Render once without disabled to expand, then re-render with disabled
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} />,
    );
    // Expand the panel
    act(() => {
      click(el, '.advanced-settings__toggle');
    });
    expect(el.querySelector('.advanced-settings__body')).toBeTruthy();
    // Now re-render with disabled prop - Preact will reuse the DOM node
    act(() => {
      render(
        <AdvancedSettings config={DEFAULT_CONFIG} onChange={() => {}} disabled />,
        el,
      );
    });
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    const durationInput = el.querySelector('input[type="number"][min="1"]') as HTMLInputElement;
    expect(durationInput.disabled).toBe(true);
    const select = el.querySelector('select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    const parallelInput = el.querySelector('input[type="number"][max="32"]') as HTMLInputElement;
    expect(parallelInput.disabled).toBe(true);
  });

  it('disables duration input when mode is continuous', () => {
    const config: SpeedTestConfig = { ...DEFAULT_CONFIG, mode: 'continuous' };
    const el = renderToContainer(
      <AdvancedSettings config={config} onChange={() => {}} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const durationInput = el.querySelector('input[type="number"][min="1"]') as HTMLInputElement;
    expect(durationInput.disabled).toBe(true);
  });

  it('preserves other config values when one field changes', () => {
    const onChange = vi.fn();
    const el = renderToContainer(
      <AdvancedSettings config={DEFAULT_CONFIG} onChange={onChange} />,
    );
    act(() => {
      click(el, '.advanced-settings__toggle');
    });

    const input = el.querySelector('input[type="number"][min="1"]') as HTMLInputElement;
    act(() => {
      input.value = '25';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const merged = onChange.mock.calls[0][0] as SpeedTestConfig;
    expect(merged.duration).toBe(25);
    expect(merged.parallel).toBe(DEFAULT_CONFIG.parallel);
    expect(merged.packetSize).toBe(DEFAULT_CONFIG.packetSize);
    expect(merged.mode).toBe(DEFAULT_CONFIG.mode);
  });
});

// ---------------------------------------------------------------------------
// ProtocolSelector
// ---------------------------------------------------------------------------

describe('ProtocolSelector', () => {
  const savedFetch = globalThis.fetch;

  beforeEach(() => {
    window.SPEEDBOX_API_BASE = 'http://localhost:8080';
  });

  afterEach(() => {
    delete window.SPEEDBOX_API_BASE;
    globalThis.fetch = savedFetch;
  });

  it('renders three protocol tabs', () => {
    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toBe('HTTP');
    expect(tabs[1].textContent).toBe('WebSocket');
    expect(tabs[2].textContent).toBe('WebRTC');
  });

  it('fetches /info on mount', async () => {
    const spy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ features: ['http', 'ws', 'webrtc'] }),
    });
    globalThis.fetch = spy;

    act(() => {
      renderToContainer(
        <ProtocolSelector selected="http" onSelect={() => {}} />,
      );
    });
    // Flush fetch promise chain
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('http://localhost:8080/info');
  });

  it('applies selected class to active tab', () => {
    const el = renderToContainer(
      <ProtocolSelector selected="ws" onSelect={() => {}} />,
    );
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs[0].classList.contains('fui-Tab--selected')).toBe(false);
    expect(tabs[1].classList.contains('fui-Tab--selected')).toBe(true);
    expect(tabs[2].classList.contains('fui-Tab--selected')).toBe(false);
  });

  it('sets aria-selected on active tab', () => {
    const el = renderToContainer(
      <ProtocolSelector selected="webrtc" onSelect={() => {}} />,
    );
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  });

  it('calls onSelect when available tab is clicked', () => {
    const onSelect = vi.fn();
    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={onSelect} />,
    );
    const tabs = el.querySelectorAll('[role="tab"]');
    act(() => {
      (tabs[2] as HTMLElement).click(); // WebRTC
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('webrtc');
  });

  it('disables tabs not in server features list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ features: ['http'] }),
    });

    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );

    // Wait for fetch + state update to flush
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const tabs = el.querySelectorAll('[role="tab"]');
    expect((tabs[0] as HTMLButtonElement).disabled).toBe(false); // HTTP available
    expect((tabs[1] as HTMLButtonElement).disabled).toBe(true);  // WS not in features
    expect((tabs[2] as HTMLButtonElement).disabled).toBe(true);  // WebRTC not in features
  });

  it('enables all tabs when features list is empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ features: [] }),
    });

    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const tabs = el.querySelectorAll('[role="tab"]');
    expect((tabs[0] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[1] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[2] as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables all tabs when features is missing from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
    });

    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    // features.length === 0 from initial state → all enabled
    const tabs = el.querySelectorAll('[role="tab"]');
    expect((tabs[0] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[1] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[2] as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not call onSelect when tab is disabled', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ features: ['http'] }),
    });

    const onSelect = vi.fn();
    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={onSelect} />,
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const tabs = el.querySelectorAll('[role="tab"]');
    act(() => {
      (tabs[1] as HTMLElement).click(); // WS — disabled
      (tabs[2] as HTMLElement).click(); // WebRTC — disabled
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('handles fetch error gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    // With features still empty, all tabs remain enabled
    const tabs = el.querySelectorAll('[role="tab"]');
    expect((tabs[0] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[1] as HTMLButtonElement).disabled).toBe(false);
    expect((tabs[2] as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds title attribute to disabled tabs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ features: ['http'] }),
    });

    const el = renderToContainer(
      <ProtocolSelector selected="http" onSelect={() => {}} />,
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs[1].getAttribute('title')).toBe('Not supported by server');
    expect(tabs[2].getAttribute('title')).toBe('Not supported by server');
    expect(tabs[0].getAttribute('title')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// BackendConfig
// ---------------------------------------------------------------------------

describe('BackendConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.SPEEDBOX_API_BASE;
  });

  it('shows "(same origin)" when no backend is configured', () => {
    const el = renderToContainer(<BackendConfig />);
    const value = el.querySelector('.backend-config__value');
    expect(value!.textContent).toBe('(same origin)');
  });

  it('shows configured backend URL', async () => {
    localStorage.setItem('speedbox_api_base', 'http://192.168.1.1:8080');

    const el = renderToContainer(<BackendConfig />);

    // Flush useEffect that reads apiBase()
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const value = el.querySelector('.backend-config__value');
    expect(value!.textContent).toBe('http://192.168.1.1:8080');
  });

  it('shows Backend label', () => {
    const el = renderToContainer(<BackendConfig />);
    const label = el.querySelector('.backend-config__label');
    expect(label!.textContent).toBe('Backend:');
  });

  it('shows Edit button in display mode', () => {
    const el = renderToContainer(<BackendConfig />);
    const editBtn = el.querySelector('button');
    expect(editBtn!.textContent).toBe('Edit');
  });

  it('shows input and action buttons after clicking Edit', () => {
    const el = renderToContainer(<BackendConfig />);
    act(() => {
      click(el, 'button'); // Edit
    });

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const buttons = el.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toContain('Save');
    expect(labels).toContain('Reset');
    expect(labels).toContain('Cancel');
  });

  it('input contains current URL after clicking Edit', async () => {
    localStorage.setItem('speedbox_api_base', 'http://10.0.0.1:9090');

    const el = renderToContainer(<BackendConfig />);

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    act(() => {
      click(el, 'button');
    });

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('http://10.0.0.1:9090');
  });

  it('Save persists value and exits editing', async () => {
    const el = renderToContainer(<BackendConfig />);
    act(() => {
      click(el, 'button'); // Edit
    });

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      input.value = 'http://new-host:8080';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Click Save
    const buttons = el.querySelectorAll('button');
    const saveBtn = Array.from(buttons).find((b) => b.textContent === 'Save')!;
    act(() => {
      saveBtn.click();
    });

    // Should be back to display mode
    expect(el.querySelector('input[type="text"]')).toBeNull();
    const value = el.querySelector('.backend-config__value');
    expect(value!.textContent).toBe('http://new-host:8080');

    // Persisted to localStorage
    expect(localStorage.getItem('speedbox_api_base')).toBe('http://new-host:8080');
  });

  it('Cancel reverts to original value and exits editing', async () => {
    localStorage.setItem('speedbox_api_base', 'http://original:8080');

    const el = renderToContainer(<BackendConfig />);

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    act(() => {
      click(el, 'button'); // Edit
    });

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      input.value = 'http://changed:9090';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Click Cancel
    const buttons = el.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent === 'Cancel')!;
    act(() => {
      cancelBtn.click();
    });

    // Back to display mode showing original URL
    expect(el.querySelector('input[type="text"]')).toBeNull();
    const value = el.querySelector('.backend-config__value');
    expect(value!.textContent).toBe('http://original:8080');

    // localStorage unchanged
    expect(localStorage.getItem('speedbox_api_base')).toBe('http://original:8080');
  });

  it('Reset clears the backend URL', async () => {
    localStorage.setItem('speedbox_api_base', 'http://old:8080');

    const el = renderToContainer(<BackendConfig />);

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    act(() => {
      click(el, 'button'); // Edit
    });

    // Click Reset
    const buttons = el.querySelectorAll('button');
    const resetBtn = Array.from(buttons).find((b) => b.textContent === 'Reset')!;
    act(() => {
      resetBtn.click();
    });

    // Back to display mode showing (same origin)
    expect(el.querySelector('input[type="text"]')).toBeNull();
    const value = el.querySelector('.backend-config__value');
    expect(value!.textContent).toBe('(same origin)');

    // localStorage cleared
    expect(localStorage.getItem('speedbox_api_base')).toBeNull();
  });

  it('Edit button is disabled when disabled prop is true', async () => {
    const el = renderToContainer(<BackendConfig disabled />);
    // Wait for useEffect to set initial state
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    const editBtn = el.querySelector('button') as HTMLButtonElement;
    expect(editBtn.disabled).toBe(true);
  });
});
