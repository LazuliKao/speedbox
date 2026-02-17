import { type FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import type { SpeedTestConfig } from '../lib/speedtest';

interface AdvancedSettingsProps {
  config: SpeedTestConfig;
  onChange: (config: SpeedTestConfig) => void;
  disabled?: boolean;
}

export const AdvancedSettings: FunctionalComponent<AdvancedSettingsProps> = ({
  config,
  onChange,
  disabled,
}) => {
  const [collapsed, setCollapsed] = useState(true);

  const update = (patch: Partial<SpeedTestConfig>) => {
    onChange({ ...config, ...patch });
  };

  const PACKET_SIZES = [
    { label: '16 KB', value: 16 * 1024 },
    { label: '32 KB', value: 32 * 1024 },
    { label: '64 KB', value: 64 * 1024 },
    { label: '128 KB', value: 128 * 1024 },
    { label: '256 KB', value: 256 * 1024 },
    { label: '512 KB', value: 512 * 1024 },
    { label: '1 MB', value: 1024 * 1024 },
  ];

  return (
    <div class="advanced-settings">
      <button
        class="advanced-settings__toggle"
        onClick={() => setCollapsed(!collapsed)}
        disabled={disabled}
      >
        {collapsed ? '▶' : '▼'} ⚙ Advanced Settings
      </button>

      {!collapsed && (
        <div class="advanced-settings__body">
          {/* Mode */}
          <div class="settings-row">
            <label>Mode</label>
            <div class="mode-toggle">
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={config.mode === 'single'}
                  onChange={() => update({ mode: 'single' })}
                  disabled={disabled}
                />
                Single
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={config.mode === 'continuous'}
                  onChange={() => update({ mode: 'continuous' })}
                  disabled={disabled}
                />
                Continuous
              </label>
            </div>
          </div>

          {/* Duration */}
          <div class="settings-row">
            <label>Duration (sec)</label>
            <input
              type="number"
              min="1"
              max="120"
              value={config.duration}
              onInput={(e) => update({ duration: Number((e.target as HTMLInputElement).value) })}
              disabled={disabled || config.mode === 'continuous'}
            />
          </div>

          {/* Packet Size */}
          <div class="settings-row">
            <label>Packet Size</label>
            <select
              value={config.packetSize}
              onChange={(e) => update({ packetSize: Number((e.target as HTMLSelectElement).value) })}
              disabled={disabled}
            >
              {PACKET_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Parallel Streams */}
          <div class="settings-row">
            <label>Parallel Streams</label>
            <input
              type="number"
              min="1"
              max="32"
              value={config.parallel}
              onInput={(e) => update({ parallel: Number((e.target as HTMLInputElement).value) })}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
};
