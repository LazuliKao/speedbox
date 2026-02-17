import { useState, useCallback, useRef } from 'preact/hooks';
import { startDownload, startUpload, type ProgressInfo } from './api';

export type SpeedTestState = 'idle' | 'downloading' | 'uploading' | 'done' | 'error';

export interface HistoryPoint {
  t: number;
  v: number;
}

export interface UseSpeedTestResult {
  state: SpeedTestState;
  downloadSpeed: number;
  uploadSpeed: number;
  downloadHistory: HistoryPoint[];
  uploadHistory: HistoryPoint[];
  error: string | null;
  run: (durationSec?: number, uploadSizeMB?: number) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * Speed-test hook: manages download/upload test state.
 */
export function useSpeedTest(): UseSpeedTestResult {
  const [state, setState] = useState<SpeedTestState>('idle');
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [downloadHistory, setDownloadHistory] = useState<HistoryPoint[]>([]);
  const [uploadHistory, setUploadHistory] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setDownloadHistory([]);
    setUploadHistory([]);
    setError(null);
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState('done');
  }, []);

  const run = useCallback(
    async (durationSec: number = 10, uploadSizeMB: number = 32) => {
      reset();
      const ac = new AbortController();
      abortRef.current = ac;

      // --- Download phase ---
      try {
        setState('downloading');
        const dlTimeout = setTimeout(() => ac.abort(), durationSec * 1000);
        await startDownload(
          (p: ProgressInfo) => {
            setDownloadSpeed(p.speedMbps);
            setDownloadHistory((h) => [...h, { t: p.elapsed, v: p.speedMbps }]);
          },
          ac.signal
        );
        clearTimeout(dlTimeout);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(`Download failed: ${(e as Error).message}`);
          setState('error');
          return;
        }
      }

      // --- Upload phase ---
      try {
        setState('uploading');
        const ac2 = new AbortController();
        abortRef.current = ac2;
        await startUpload(
          (p: ProgressInfo) => {
            setUploadSpeed(p.speedMbps);
            setUploadHistory((h) => [...h, { t: p.elapsed, v: p.speedMbps }]);
          },
          ac2.signal,
          uploadSizeMB
        );
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(`Upload failed: ${(e as Error).message}`);
          setState('error');
          return;
        }
      }

      setState('done');
      abortRef.current = null;
    },
    [reset]
  );

  return {
    state,
    downloadSpeed,
    uploadSpeed,
    downloadHistory,
    uploadHistory,
    error,
    run,
    stop,
    reset,
  };
}
