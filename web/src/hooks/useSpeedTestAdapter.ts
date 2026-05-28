import { useState, useRef, useCallback, useEffect } from 'preact/hooks';
import {
  HttpAdapter,
  WebSocketAdapter,
  type SpeedTestAdapter,
  type SpeedTestConfig,
  type TestState,
  type TestDirection,
  type HistoryPoint,
  type SpeedProgress,
} from '../lib/index';
import type { Protocol } from '../components/ProtocolSelector';

export function useSpeedTestAdapter() {
  const adapterRef = useRef<SpeedTestAdapter | null>(null);
  
  const [state, setState] = useState<TestState>('idle');
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [downloadHistory, setDownloadHistory] = useState<HistoryPoint[]>([]);
  const [uploadHistory, setUploadHistory] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setDownloadHistory([]);
    setUploadHistory([]);
    setError(null);
  }, []);

  const stop = useCallback(() => {
    if (adapterRef.current) {
      adapterRef.current.stop();
    }
  }, []);

  const run = useCallback(async (
    protocol: Protocol,
    direction: TestDirection,
    config: SpeedTestConfig
  ) => {
    if (adapterRef.current) {
      adapterRef.current.destroy();
      adapterRef.current = null;
    }

    reset();

    const createAdapter = () => {
      switch (protocol) {
        case 'http':
          return new HttpAdapter();
        case 'ws':
          return new WebSocketAdapter();
        case 'webrtc':
          throw new Error('WebRTC uses useWebRtcPairing hook, not useSpeedTestAdapter');
        default:
          throw new Error(`Unknown protocol: ${protocol}`);
      }
    };

    const runSingleTest = async (dir: TestDirection): Promise<TestState> => {
      const adapter = createAdapter();
      adapterRef.current = adapter;

      let finalState: TestState = 'idle';

      await adapter.start(dir, config, {
        onProgress: (d: TestDirection, p: SpeedProgress) => {
          if (d === 'download') {
            setDownloadSpeed(p.speedMbps);
            setDownloadHistory(prev => [...prev, { t: p.elapsed, v: p.speedMbps }]);
          } else {
            setUploadSpeed(p.speedMbps);
            setUploadHistory(prev => [...prev, { t: p.elapsed, v: p.speedMbps }]);
          }
        },
        onStateChange: (s: TestState) => {
          setState(s);
          finalState = s;
        },
        onError: (err: string) => {
          setError(err);
          setState('error');
          finalState = 'error';
        }
      });

      adapter.destroy();
      adapterRef.current = null;

      return finalState;
    };

    try {
      if (config.mode === 'single' && direction === 'download') {
        // Run download phase
        const phase1Result = await runSingleTest('download');
        // Only continue to upload if download completed normally
        if (phase1Result === 'done') {
          await runSingleTest('upload');
        }
        // If interrupted or error, state is already set by adapter
      } else {
        await runSingleTest(direction);
      }

  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : 'Failed to start test');
    setState('error');
  }
  }, [reset]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (adapterRef.current) {
        adapterRef.current.destroy();
      }
    };
  }, []);

  return {
    state,
    downloadSpeed,
    uploadSpeed,
    downloadHistory,
    uploadHistory,
    error,
    run,
    stop,
    reset
  };
}
