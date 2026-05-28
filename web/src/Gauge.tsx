import type { FunctionalComponent } from 'preact';

export interface GaugeProps {
  value?: number;
  max?: number;
  label?: string;
  size?: number;
  active?: boolean;
  color?: string;
}

export const Gauge: FunctionalComponent<GaugeProps> = ({
  value = 0,
  max = 1000,
  label = 'Mbps',
  size = 200,
  active = false,
  color,
}) => {
  const r = 80;
  const cx = 100;
  const cy = 100;
  const circumference = Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);

  const valueColor = color || (
    pct > 0.8
      ? 'var(--colorStatusSuccessForeground1)'
      : pct > 0.4
        ? 'var(--colorStatusWarningForeground1)'
        : 'var(--colorCompoundBrandStroke)'
  );

  return (
    <svg
      class={`gauge ${active ? 'gauge--active' : ''}`}
      width={size}
      height={size * 0.6}
      viewBox="0 0 200 120"
    >
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        style={{ stroke: 'var(--colorNeutralStroke2)' }}
        stroke-width="14"
        stroke-linecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        style={{ stroke: valueColor, transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
        stroke-width="14"
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={offset}
      />
      <text x={cx} y={cy - 15} text-anchor="middle" font-size="28" font-weight="bold"
        style={{ fill: 'var(--colorNeutralForeground1)', fontFamily: 'var(--fontFamilyBase)' }}>
        {value < 10 ? value.toFixed(1) : Math.round(value)}
      </text>
      <text x={cx} y={cy + 5} text-anchor="middle" font-size="13"
        style={{ fill: 'var(--colorNeutralForeground3)', fontFamily: 'var(--fontFamilyBase)' }}>
        {label}
      </text>
    </svg>
  );
};
