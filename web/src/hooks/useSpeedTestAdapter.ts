import { useState, useRef, useCallback, useEffect } from 'preact/hooks';
import {
  HttpAdapter,
  WebSocketAdapter,
  WebRtcAdapter,
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
    config: SpeedTestConfig,
    roomId?: string
  ) => {
    // cleanup previous
    if (adapterRef.current) {
      adapterRef.current.destroy();
      adapterRef.current = null;
    }

    reset();

    // Create adapter
    try {
      switch (protocol) {
        case 'http':
          adapterRef.current = new HttpAdapter();
          break;
        case 'ws':
          adapterRef.current = new WebSocketAdapter();
          break;
        case 'webrtc':
          if (!roomId) throw new Error('Room ID required for WebRTC');
          adapterRef.current = new WebRtcAdapter({ roomId });
          break;
        default:
          throw new Error(`Unknown protocol: ${protocol}`);
      }

      const adapter = adapterRef.current;

      await adapter.start(direction, config, {
        onProgress: (dir: TestDirection, p: SpeedProgress) => {
          if (dir === 'download') {
            setDownloadSpeed(p.speedMbps);
            setDownloadHistory(prev => [...prev, { t: p.elapsed, v: p.speedMbps }]);
          } else {
            setUploadSpeed(p.speedMbps);
            setUploadHistory(prev => [...prev, { t: p.elapsed, v: p.speedMbps }]);
          }
        },
        onStateChange: (s: TestState) => {
          setState(s);
        },
        onError: (err: string) => {
          setError(err);
          setState('error');
        }
      });

      setState('done');

    } catch (e: any) {
      setError(e.message || 'Failed to start test');
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
