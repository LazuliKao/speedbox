import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { Gauge, type GaugeProps } from '../src/Gauge';

function renderToContainer(vnode: preact.VNode<GaugeProps>) {
  const container = document.createElement('div');
  render(vnode, container);
  return container;
}

describe('Gauge', () => {
  it('renders an SVG element', () => {
    const el = renderToContainer(<Gauge value={50} />);
    const svg = el.querySelector('svg.gauge');
    expect(svg).toBeTruthy();
  });

  it('displays rounded value for >= 10', () => {
    const el = renderToContainer(<Gauge value={123.4} />);
    const text = el.querySelector('text');
    expect(text!.textContent).toBe('123');
  });

  it('displays one decimal for < 10', () => {
    const el = renderToContainer(<Gauge value={5.67} />);
    const text = el.querySelector('text');
    expect(text!.textContent).toBe('5.7');
  });

  it('shows label text', () => {
    const el = renderToContainer(<Gauge value={0} label="↓ Mbps" />);
    const texts = el.querySelectorAll('text');
    const labelText = texts[texts.length - 1].textContent;
    expect(labelText).toBe('↓ Mbps');
  });

  it('applies active class when active=true', () => {
    const el = renderToContainer(<Gauge value={0} active={true} />);
    const svg = el.querySelector('svg');
    expect(svg!.classList.contains('gauge--active')).toBe(true);
  });

  it('clamps percentage to 1.0 for value > max', () => {
    const el = renderToContainer(<Gauge value={2000} max={1000} />);
    expect(el.querySelector('svg')).toBeTruthy();
  });
});
