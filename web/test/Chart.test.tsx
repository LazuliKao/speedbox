import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { Chart, type ChartProps } from '../src/Chart';

function renderToContainer(vnode: preact.VNode<ChartProps>) {
  const container = document.createElement('div');
  render(vnode, container);
  return container;
}

describe('Chart', () => {
  it('returns null for fewer than 2 data points', () => {
    const el = renderToContainer(<Chart data={[]} />);
    expect(el.querySelector('svg')).toBeNull();

    const el2 = renderToContainer(<Chart data={[{ t: 0, v: 10 }]} />);
    expect(el2.querySelector('svg')).toBeNull();
  });

  it('renders a polyline for 2+ data points', () => {
    const data = [
      { t: 0, v: 10 },
      { t: 1, v: 20 },
      { t: 2, v: 15 },
    ];
    const el = renderToContainer(<Chart data={data} color="#f00" />);
    const polyline = el.querySelector('polyline');
    expect(polyline).toBeTruthy();
    expect(polyline!.getAttribute('stroke')).toBe('#f00');
  });

  it('generates correct number of points', () => {
    const data = Array.from({ length: 5 }, (_, i) => ({ t: i, v: i * 10 }));
    const el = renderToContainer(<Chart data={data} />);
    const points = el.querySelector('polyline')!.getAttribute('points')!.split(' ');
    expect(points.length).toBe(5);
  });
});
