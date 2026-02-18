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
    { label: '16 KB',  value: 16 * 1024 },
    { label: '32 KB',  value: 32 * 1024 },
    { label: '64 KB',  value: 64 * 1024 },
    { label: '128 KB', value: 128 * 1024 },
    { label: '256 KB', value: 256 * 1024 },
    { label: '512 KB', value: 512 * 1024 },
    { label: '1 MB',   value: 1024 * 1024 },
  ];

  return (
    <div class="advanced-settings">
      <button
        class="advanced-settings__toggle"
        onClick={() => setCollapsed(!collapsed)}
        disabled={disabled}
      >
        <span>⚙ Advanced Settings</span>
        <span class={`advanced-settings__chevron${!collapsed ? ' advanced-settings__chevron--open' : ''}`}>›</span>
      </button>

      {!collapsed && (
        <div class="advanced-settings__body">
          {/* Mode — Switch toggle */}
          <div class="settings-row">
            <span class="settings-label">Continuous Mode</span>
            <label class="fui-Switch">
              <input
                class="fui-Switch__input"
                type="checkbox"
                checked={config.mode === 'continuous'}
                onChange={(e) => update({ mode: (e.target as HTMLInputElement).checked ? 'continuous' : 'single' })}
                disabled={disabled}
              />
              <span class="fui-Switch__indicator" />
              <span class="fui-Switch__label">
                {config.mode === 'continuous' ? 'On' : 'Off'}
              </span>
            </label>
          </div>

          {/* Duration */}
          <div class="settings-row">
            <span class="settings-label">Duration (sec)</span>
            <div class={`fui-Input${(disabled || config.mode === 'continuous') ? ' fui-Input--disabled' : ''}`}
                 style={{ width: '100px' }}>
              <input
                class="fui-Input__input"
                type="number"
                min="1"
                max="120"
                value={config.duration}
                onInput={(e) => update({ duration: Number((e.target as HTMLInputElement).value) })}
                disabled={disabled || config.mode === 'continuous'}
              />
            </div>
          </div>

          {/* Packet Size */}
          <div class="settings-row">
            <span class="settings-label">Packet Size</span>
            <div class={`fui-Select${disabled ? ' fui-Select--disabled' : ''}`} style={{ width: '110px' }}>
              <select
                class="fui-Select__select"
                value={config.packetSize}
                onChange={(e) => update({ packetSize: Number((e.target as HTMLSelectElement).value) })}
                disabled={disabled}
              >
                {PACKET_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <span class="fui-Select__icon">▾</span>
            </div>
          </div>

          {/* Parallel Streams */}
          <div class="settings-row">
            <span class="settings-label">Parallel Streams</span>
            <div class={`fui-Input${disabled ? ' fui-Input--disabled' : ''}`} style={{ width: '100px' }}>
              <input
                class="fui-Input__input"
                type="number"
                min="1"
                max="32"
                value={config.parallel}
                onInput={(e) => update({ parallel: Number((e.target as HTMLInputElement).value) })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
