/**
 * SVG gauge component — pure CSS/SVG, no heavy chart library.
 * Displays a speed value (Mbps) as a semicircular arc.
 */
export function Gauge({ value = 0, max = 1000, label = 'Mbps', size = 200, active = false }) {
  const r = 80;
  const cx = 100;
  const cy = 100;
  const circumference = Math.PI * r; // semicircle
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);

  return (
    <svg
      class={`gauge ${active ? 'gauge--active' : ''}`}
      width={size}
      height={size * 0.6}
      viewBox="0 0 200 120"
    >
      {/* Background arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#e0e0e0"
        stroke-width="14"
        stroke-linecap="round"
      />
      {/* Value arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={pct > 0.8 ? '#4caf50' : pct > 0.4 ? '#ff9800' : '#2196f3'}
        stroke-width="14"
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
      {/* Value text */}
      <text x={cx} y={cy - 15} text-anchor="middle" font-size="28" font-weight="bold" fill="#333">
        {value < 10 ? value.toFixed(1) : Math.round(value)}
      </text>
      {/* Label */}
      <text x={cx} y={cy + 5} text-anchor="middle" font-size="13" fill="#888">
        {label}
      </text>
    </svg>
  );
}
