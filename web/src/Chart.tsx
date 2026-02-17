import type { FunctionalComponent } from 'preact';
import type { HistoryPoint } from './lib/speedtest';

export interface ChartProps {
  data?: HistoryPoint[];
  width?: number;
  height?: number;
  color?: string;
}

export const Chart: FunctionalComponent<ChartProps> = ({
  data = [],
  width = 300,
  height = 80,
  color = '#2196f3',
}) => {
  if (data.length < 2) return null;

  const maxV = Math.max(...data.map((d) => d.v), 1);
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (d.v / maxV) * (height - 4);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg class="chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
};
