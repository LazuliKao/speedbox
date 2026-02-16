import { useSpeedTest } from './useSpeedTest';
import { Gauge } from './Gauge';
import { Chart } from './Chart';

const STATE_LABELS = {
  idle: 'Ready',
  downloading: 'Testing download speed…',
  uploading: 'Testing upload speed…',
  done: 'Test complete',
  error: 'Error',
};

export function App() {
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
  } = useSpeedTest();

  const running = state === 'downloading' || state === 'uploading';

  return (
    <div class="speedbox">
      <h1>Speedbox</h1>

      {error && <p class="error">{error}</p>}

      <div class="gauges">
        <div class="gauge-group">
          <Gauge
            value={downloadSpeed}
            label="↓ Mbps"
            active={state === 'downloading'}
          />
          <Chart data={downloadHistory} color="#2196f3" />
        </div>
        <div class="gauge-group">
          <Gauge
            value={uploadSpeed}
            label="↑ Mbps"
            active={state === 'uploading'}
          />
          <Chart data={uploadHistory} color="#4caf50" />
        </div>
      </div>

      <p class={`state ${running ? 'state--active' : ''}`}>
        {running && <span class="spinner" />}
        {STATE_LABELS[state] || state}
      </p>

      <div class="controls">
        {!running && (
          <button class="start-button" onClick={() => run()}>
            {state === 'done' ? 'Re-test' : 'Start'}
          </button>
        )}
        {running && (
          <button class="stop-button" onClick={stop}>
            Stop
          </button>
        )}
        {state === 'done' && (
          <button class="reset-button" onClick={reset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
