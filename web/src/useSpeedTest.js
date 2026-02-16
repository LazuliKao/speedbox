import { useState, useCallback, useRef } from 'preact/hooks';
import { startDownload, startUpload } from './api';

/**
 * Speed-test states: idle | downloading | uploading | done | error
 */
export function useSpeedTest() {
  const [state, setState] = useState('idle');
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

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

  const run = useCallback(async (durationSec = 10, uploadSizeMB = 32) => {
    reset();
    const ac = new AbortController();
    abortRef.current = ac;

    // --- Download phase ---
    try {
      setState('downloading');
      const dlTimeout = setTimeout(() => ac.abort(), durationSec * 1000);
      await startDownload(
        (p) => {
          setDownloadSpeed(p.speedMbps);
          setDownloadHistory((h) => [...h, { t: p.elapsed, v: p.speedMbps }]);
        },
        ac.signal,
      );
      clearTimeout(dlTimeout);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(`Download failed: ${e.message}`);
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
        (p) => {
          setUploadSpeed(p.speedMbps);
          setUploadHistory((h) => [...h, { t: p.elapsed, v: p.speedMbps }]);
        },
        ac2.signal,
        uploadSizeMB,
      );
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(`Upload failed: ${e.message}`);
        setState('error');
        return;
      }
    }

    setState('done');
    abortRef.current = null;
  }, [reset]);

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
