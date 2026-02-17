import { type FunctionalComponent } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { Gauge } from './Gauge';
import { Chart } from './Chart';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ProtocolSelector, type Protocol } from './components/ProtocolSelector';
import { BackendConfig } from './components/BackendConfig';
import { PairingPanel } from './components/PairingPanel';
import { useSpeedTestAdapter } from './hooks/useSpeedTestAdapter';
import { useWebRtcPairing } from './hooks/useWebRtcPairing';
import { DEFAULT_CONFIG, type SpeedTestConfig, type TestDirection } from './lib/speedtest';

export const App: FunctionalComponent = () => {
  const [config, setConfig] = useState<SpeedTestConfig>(DEFAULT_CONFIG);
  const [protocol, setProtocol] = useState<Protocol>('http');

  // HTTP/WS speed test hook
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

  // WebRTC pairing hook
  const webrtc = useWebRtcPairing();

  const isWebRtc = protocol === 'webrtc';
  const isPaired = isWebRtc && webrtc.pairingState === 'paired';

  // For WebRTC: local test state tracked separately
  const [webrtcState, setWebrtcState] = useState<'idle' | 'downloading' | 'uploading' | 'done' | 'error'>('idle');
  const [webrtcDownloadSpeed, setWebrtcDownloadSpeed] = useState(0);
  const [webrtcUploadSpeed, setWebrtcUploadSpeed] = useState(0);
  const [webrtcDownloadHistory, setWebrtcDownloadHistory] = useState<{ t: number; v: number }[]>([]);
  const [webrtcUploadHistory, setWebrtcUploadHistory] = useState<{ t: number; v: number }[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  // Which state/speeds to display
  const displayState = isWebRtc ? webrtcState : state;
  const displayDownloadSpeed = isWebRtc ? webrtcDownloadSpeed : downloadSpeed;
  const displayUploadSpeed = isWebRtc ? webrtcUploadSpeed : uploadSpeed;
  const displayDownloadHistory = isWebRtc ? webrtcDownloadHistory : downloadHistory;
  const displayUploadHistory = isWebRtc ? webrtcUploadHistory : uploadHistory;
  const displayError = isWebRtc ? webrtcError : error;

  const isRunning = displayState === 'downloading' || displayState === 'uploading';
  const isDone = displayState === 'done';

  const handleWebRtcTest = useCallback(async (direction: TestDirection) => {
    if (!webrtc.adapter) return;
    setWebrtcError(null);

    try {
      await webrtc.adapter.start(direction, config, {
        onProgress: (dir, progress) => {
          if (dir === 'download') {
            setWebrtcDownloadSpeed(progress.speedMbps ?? 0);
            setWebrtcDownloadHistory(prev => [...prev, { t: progress.elapsed, v: progress.speedMbps ?? 0 }]);
          } else {
            setWebrtcUploadSpeed(progress.speedMbps ?? 0);
            setWebrtcUploadHistory(prev => [...prev, { t: progress.elapsed, v: progress.speedMbps ?? 0 }]);
          }
        },
        onStateChange: (s) => setWebrtcState(s),
        onError: (e) => setWebrtcError(e),
      });
    } catch (e) {
      setWebrtcError(String(e));
      setWebrtcState('error');
    }
  }, [webrtc.adapter, config]);

  const handleStartBothWebRtc = useCallback(async () => {
    if (!webrtc.adapter) return;
    setWebrtcDownloadSpeed(0);
    setWebrtcUploadSpeed(0);
    setWebrtcDownloadHistory([]);
    setWebrtcUploadHistory([]);
    setWebrtcError(null);
    setWebrtcState('downloading');

    await handleWebRtcTest('download');
    if (webrtcState !== 'error') {
      await handleWebRtcTest('upload');
    }
    setWebrtcState('done');
  }, [handleWebRtcTest, webrtcState, webrtc.adapter]);

  const handleStart = (direction: TestDirection) => {
    if (isWebRtc) {
      handleWebRtcTest(direction);
    } else {
      run(protocol, direction, config);
    }
  };

  const handleStartBoth = () => {
    if (isWebRtc) {
      handleStartBothWebRtc();
    } else {
      run(protocol, 'download', config);
    }
  };

  const handleStop = () => {
    if (isWebRtc && webrtc.adapter) {
      webrtc.adapter.stop();
      setWebrtcState('idle');
    } else {
      stop();
    }
  };

  const handleReset = () => {
    if (isWebRtc) {
      setWebrtcState('idle');
      setWebrtcDownloadSpeed(0);
      setWebrtcUploadSpeed(0);
      setWebrtcDownloadHistory([]);
      setWebrtcUploadHistory([]);
      setWebrtcError(null);
    } else {
      reset();
    }
  };

  let stateLabel = 'Idle';
  if (displayState === 'downloading') stateLabel = 'Downloading...';
  else if (displayState === 'uploading') stateLabel = 'Uploading...';
  else if (displayState === 'done') stateLabel = 'Test Complete';
  else if (displayState === 'error') stateLabel = 'Error';

  const canStart = isWebRtc ? isPaired && !isRunning : !isRunning;

  return (
    <div class="speedbox">
      <h1>Speedbox</h1>

      <BackendConfig disabled={isRunning} />

      <ProtocolSelector
        selected={protocol}
        onSelect={setProtocol}
        disabled={isRunning}
      />

      {isWebRtc && (
        <PairingPanel
          pairingState={webrtc.pairingState}
          lobbyPeers={webrtc.lobbyPeers}
          pairRequest={webrtc.pairRequest}
          partnerName={webrtc.partnerName}
          onConnect={webrtc.connect}
          onDisconnect={webrtc.disconnect}
          onRequestPair={webrtc.requestPair}
          onAcceptPair={webrtc.acceptPair}
          onRejectPair={webrtc.rejectPair}
          onUnpair={webrtc.unpair}
          disabled={isRunning}
        />
      )}

      <AdvancedSettings
        config={config}
        onChange={setConfig}
        disabled={isRunning}
      />

      <div class="gauges">
        <div class="gauge-group">
          <Gauge
            value={displayDownloadSpeed}
            label={isPaired ? 'Download (You)' : 'Download'}
            active={displayState === 'downloading'}
          />
          <Chart data={displayDownloadHistory} color="#2196f3" />
        </div>
        <div class="gauge-group">
          <Gauge
            value={displayUploadSpeed}
            label={isPaired ? 'Upload (You)' : 'Upload'}
            active={displayState === 'uploading'}
          />
          <Chart data={displayUploadHistory} color="#ff9800" />
        </div>
      </div>

      {isPaired && (
        <div class="gauges">
          <div class="gauge-group">
            <Gauge
              value={webrtc.peerDownloadSpeed}
              label={`Download (${webrtc.partnerName})`}
              active={webrtc.peerTestState === 'downloading'}
            />
            <Chart data={webrtc.peerDownloadHistory} color="#2196f3" />
          </div>
          <div class="gauge-group">
            <Gauge
              value={webrtc.peerUploadSpeed}
              label={`Upload (${webrtc.partnerName})`}
              active={webrtc.peerTestState === 'uploading'}
            />
            <Chart data={webrtc.peerUploadHistory} color="#ff9800" />
          </div>
        </div>
      )}

      <div class={`state ${isRunning ? 'state--active' : ''}`}>
        {stateLabel}
      </div>

      {displayError && <div class="error">{displayError}</div>}

      <div class="controls">
        {canStart && !isDone && config.mode === 'single' && (
          <button
            class="start-button"
            onClick={handleStartBoth}
          >
            ▶ Start Speed Test
          </button>
        )}

        {canStart && !isDone && config.mode === 'continuous' && (
          <>
            <button
              class="start-button"
              onClick={() => handleStart('download')}
            >
              ▶ Download
            </button>
            <button
              class="start-button"
              onClick={() => handleStart('upload')}
            >
              ▲ Upload
            </button>
          </>
        )}

        {isRunning && (
          <button class="stop-button" onClick={handleStop}>
            ⏹ Stop
          </button>
        )}

        {isDone && (
          <button class="reset-button" onClick={handleReset}>
            ↺ Reset
          </button>
        )}
      </div>
    </div>
  );
};
