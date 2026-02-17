import { type FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { Gauge } from './Gauge';
import { Chart } from './Chart';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ProtocolSelector, type Protocol } from './components/ProtocolSelector';
import { BackendConfig } from './components/BackendConfig';
import { useSpeedTestAdapter } from './hooks/useSpeedTestAdapter';
import { DEFAULT_CONFIG, type SpeedTestConfig } from './lib/speedtest';

export const App: FunctionalComponent = () => {
  const [config, setConfig] = useState<SpeedTestConfig>(DEFAULT_CONFIG);
  const [protocol, setProtocol] = useState<Protocol>('http');
  const [roomId, setRoomId] = useState('');

  const {
    state,
    downloadSpeed,
    uploadSpeed,
    downloadHistory,
    uploadHistory,
    error,
    run,
    stop,
    reset,
  } = useSpeedTestAdapter();

  const isRunning = state === 'downloading' || state === 'uploading';
  const isDone = state === 'done';

  const handleStart = (direction: 'download' | 'upload') => {
    run(protocol, direction, config, roomId);
  };

  const handleStartBoth = () => {
    run(protocol, 'download', config, roomId);
  };

  let stateLabel = 'Idle';
  if (state === 'downloading') stateLabel = 'Downloading...';
  else if (state === 'uploading') stateLabel = 'Uploading...';
  else if (state === 'done') stateLabel = 'Test Complete';
  else if (state === 'error') stateLabel = 'Error';

  return (
    <div class="speedbox">
      <h1>Speedbox</h1>

      <BackendConfig disabled={isRunning} />

      <ProtocolSelector
        selected={protocol}
        onSelect={setProtocol}
        roomId={roomId}
        onRoomIdChange={setRoomId}
        disabled={isRunning}
      />

      <AdvancedSettings
        config={config}
        onChange={setConfig}
        disabled={isRunning}
      />

      <div class="gauges">
        <div class="gauge-group">
          <Gauge
            value={downloadSpeed}
            label="Download"
            active={state === 'downloading'}
          />
          <Chart data={downloadHistory} color="#2196f3" />
        </div>
        <div class="gauge-group">
          <Gauge
            value={uploadSpeed}
            label="Upload"
            active={state === 'uploading'}
          />
          <Chart data={uploadHistory} color="#ff9800" />
        </div>
      </div>

      <div class={`state ${isRunning ? 'state--active' : ''}`}>
        {stateLabel}
      </div>

      {error && <div class="error">{error}</div>}

      <div class="controls">
        {!isRunning && config.mode === 'single' && (
          <button
            class="start-button"
            onClick={handleStartBoth}
            disabled={protocol === 'webrtc' && !roomId}
          >
            ▶ Start Speed Test
          </button>
        )}

        {!isRunning && config.mode === 'continuous' && (
          <>
            <button
              class="start-button"
              onClick={() => handleStart('download')}
              disabled={protocol === 'webrtc' && !roomId}
            >
              ▶ Download
            </button>
            <button
              class="start-button"
              onClick={() => handleStart('upload')}
              disabled={protocol === 'webrtc' && !roomId}
            >
              ▲ Upload
            </button>
          </>
        )}

        {isRunning && (
          <button class="stop-button" onClick={stop}>
            ⏹ Stop
          </button>
        )}

        {isDone && (
          <button class="reset-button" onClick={reset}>
            ↺ Reset
          </button>
        )}
      </div>
    </div>
  );
};
