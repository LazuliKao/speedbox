import { type FunctionalComponent } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
import { Gauge } from './Gauge';
import { Chart } from './Chart';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ProtocolSelector, type Protocol } from './components/ProtocolSelector';
import { BackendConfig } from './components/BackendConfig';
import { PairingPanel } from './components/PairingPanel';
import { useSpeedTestAdapter } from './hooks/useSpeedTestAdapter';
import { useWebRtcPairing } from './hooks/useWebRtcPairing';
import { DEFAULT_CONFIG, type SpeedTestConfig, type TestDirection, type TestState } from './lib/speedtest';

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
  const [webrtcState, setWebrtcState] = useState<TestState>('idle');
  const [webrtcDownloadSpeed, setWebrtcDownloadSpeed] = useState(0);
  const [webrtcUploadSpeed, setWebrtcUploadSpeed] = useState(0);
  const [webrtcDownloadHistory, setWebrtcDownloadHistory] = useState<{ t: number; v: number }[]>([]);
  const [webrtcUploadHistory, setWebrtcUploadHistory] = useState<{ t: number; v: number }[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  const displayState = isWebRtc
    ? (webrtc.localPassiveState !== 'idle' ? webrtc.localPassiveState : webrtcState)
    : state;
  const displayDownloadSpeed = isWebRtc ? (webrtcDownloadSpeed || webrtc.localDownloadSpeed) : downloadSpeed;
  const displayUploadSpeed = isWebRtc ? (webrtcUploadSpeed || webrtc.localUploadSpeed) : uploadSpeed;
  const displayDownloadHistory = isWebRtc ? (webrtcDownloadHistory.length > 0 ? webrtcDownloadHistory : webrtc.localDownloadHistory) : downloadHistory;
  const displayUploadHistory = isWebRtc ? (webrtcUploadHistory.length > 0 ? webrtcUploadHistory : webrtc.localUploadHistory) : uploadHistory;
  const displayError = isWebRtc ? webrtcError : error;

  const isRunning = displayState === 'downloading' || displayState === 'uploading';
  const isDone = displayState === 'done' || displayState === 'interrupted';

  const finalStateRef = useRef<TestState>('idle' as TestState);

  const handleWebRtcTest = useCallback(async (direction: TestDirection, phase: number = 1): Promise<'done' | 'interrupted' | 'error'> => {
    if (!webrtc.adapter) return 'error';
    setWebrtcError(null);
    finalStateRef.current = 'idle';

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
        onStateChange: (s) => {
          setWebrtcState(s);
          finalStateRef.current = s;
        },
        onError: (e) => setWebrtcError(e),
      }, phase);
    } catch (e) {
      setWebrtcError(String(e));
      setWebrtcState('error');
      return 'error';
    }

    return (finalStateRef.current as TestState) === 'interrupted' ? 'interrupted' : 'done';
  }, [webrtc.adapter, config]);

  const handleStartBothWebRtc = useCallback(async () => {
    if (!webrtc.adapter) return;
    // Clear all history at the start of Phase 1
    setWebrtcDownloadSpeed(0);
    setWebrtcUploadSpeed(0);
    setWebrtcDownloadHistory([]);
    setWebrtcUploadHistory([]);
    setWebrtcError(null);
    setWebrtcState('downloading');

    // Phase 1: Download test (initiator downloads, passive uploads)
    const phase1Result = await handleWebRtcTest('download', 1);
    // Only continue to phase 2 if phase 1 completed normally (not interrupted or error)
    if (phase1Result === 'done') {
      // Phase 2: Upload test (initiator uploads, passive downloads)
      const phase2Result = await handleWebRtcTest('upload', 2);
      // Final state is determined by phase 2 result
      if (phase2Result === 'done') {
        setWebrtcState('done');
      }
      // If interrupted or error, the state is already set by the adapter
    }
    // If interrupted or error in phase 1, don't proceed to phase 2
  }, [handleWebRtcTest, webrtc.adapter]);

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
      if (webrtc.adapter && isRunning) {
        // If test is running, stop it (this will trigger 'interrupted' state via adapter callback)
        webrtc.adapter.stop();
      } else {
        // If not running, just reset the UI state
        setWebrtcState('idle');
        setWebrtcDownloadSpeed(0);
        setWebrtcUploadSpeed(0);
        setWebrtcDownloadHistory([]);
        setWebrtcUploadHistory([]);
        setWebrtcError(null);
        webrtc.resetPeerState();
      }
    } else {
      reset();
    }
  };

  let stateLabel = 'Idle';
  if (displayState === 'downloading') stateLabel = 'Downloading...';
  else if (displayState === 'uploading') stateLabel = 'Uploading...';
  else if (displayState === 'done') stateLabel = 'Test Complete';
  else if (displayState === 'interrupted') stateLabel = 'Test Interrupted';
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
          deviceName={webrtc.deviceName}
          getDebugInfo={webrtc.adapter?.getDebugInfo.bind(webrtc.adapter)}
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
