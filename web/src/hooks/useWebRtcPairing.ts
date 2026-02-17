import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import {
  WebRtcAdapter,
  type PairingState,
  type LobbyPeer,
  type PairRequest,
  type WebRtcEvents,
} from '../lib/adapters/webrtc';
import type {
  SpeedTestConfig,
  TestDirection,
  HistoryPoint,
  TestState,
  SpeedTestCallbacks
} from '../lib/speedtest';

export interface UseWebRtcPairingReturn {
  pairingState: PairingState;
  lobbyPeers: LobbyPeer[];
  pairRequest: PairRequest | null;
  
  connect: () => void;
  disconnect: () => void;
  requestPair: (targetId: string) => void;
  acceptPair: () => void;
  rejectPair: () => void;
  unpair: () => void;
  
  partnerId: string | null;
  partnerName: string | null;
  
  peerDownloadSpeed: number;
  peerUploadSpeed: number;
  peerTestState: TestState;
  peerDownloadHistory: HistoryPoint[];
  peerUploadHistory: HistoryPoint[];
  
  adapter: WebRtcAdapter | null;
  error: string | null;
}

export function useWebRtcPairing(): UseWebRtcPairingReturn {
  const [pairingState, setPairingState] = useState<PairingState>('disconnected');
  const [lobbyPeers, setLobbyPeers] = useState<LobbyPeer[]>([]);
  const [pairRequest, setPairRequest] = useState<PairRequest | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [peerTestState, setPeerTestState] = useState<TestState>('idle');
  const [peerDownloadSpeed, setPeerDownloadSpeed] = useState(0);
  const [peerUploadSpeed, setPeerUploadSpeed] = useState(0);
  const [peerDownloadHistory, setPeerDownloadHistory] = useState<HistoryPoint[]>([]);
  const [peerUploadHistory, setPeerUploadHistory] = useState<HistoryPoint[]>([]);

  const adapterRef = useRef<WebRtcAdapter | null>(null);
  const [adapter, setAdapter] = useState<WebRtcAdapter | null>(null);

  const handlePeerTestStart = useCallback((config: SpeedTestConfig & { initiatorDirection: TestDirection }, remoteDirection: TestDirection) => {
    setPeerTestState(remoteDirection === 'download' ? 'downloading' : 'uploading');
    setPeerDownloadSpeed(0);
    setPeerUploadSpeed(0);
    setPeerDownloadHistory([]);
    setPeerUploadHistory([]);
    
    const localDirection = remoteDirection === 'download' ? 'upload' : 'download';
    
    const callbacks: SpeedTestCallbacks = {
        onProgress: (_dir, _prog) => {
            // Local progress handling if needed
        },
        onStateChange: (state) => {
             if (state === 'done' || state === 'error') {
                 setPeerTestState('idle');
             }
        },
        onError: (err) => setError(err)
    };
    
    adapterRef.current?.startRemote(localDirection, config, callbacks).catch(e => setError(e.message));
  }, []);

  const createAdapter = useCallback(() => {
    if (adapterRef.current) return;

    const events: WebRtcEvents = {
      onPairingStateChange: (state) => {
        setPairingState(state);
        if (state === 'lobby') {
          setPairRequest(null);
          setPartnerId(null);
          setPartnerName(null);
          setPeerTestState('idle');
        }
      },
      onLobbyUpdate: (peers) => {
        setLobbyPeers(peers);
      },
      onPairRequest: (req) => {
        setPairRequest(req);
      },
      onPaired: (pid) => {
        setPartnerId(pid);
        setPairRequest(null);
        setError(null);
      },
      onUnpaired: () => {
        setPartnerId(null);
        setPartnerName(null);
        setPeerTestState('idle');
      },
      onPeerTestStart: (config) => {
        handlePeerTestStart(config, config.initiatorDirection);
      },
      onPeerTestStop: () => {
        setPeerTestState('idle');
        adapterRef.current?.stop();
      },
      onPeerTestUpdate: (progress) => {
        if (progress.direction === 'download') {
          setPeerDownloadSpeed(progress.speed);
          setPeerDownloadHistory(prev => [...prev, { t: progress.elapsed, v: progress.speed }]);
        } else {
          setPeerUploadSpeed(progress.speed);
          setPeerUploadHistory(prev => [...prev, { t: progress.elapsed, v: progress.speed }]);
        }
      },
      onError: (err) => {
        setError(err);
      }
    };

    const inst = new WebRtcAdapter(events);
    adapterRef.current = inst;
    setAdapter(inst);
    inst.connect();
  }, [handlePeerTestStart]);

  useEffect(() => {
    createAdapter();
    return () => {
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [createAdapter]);

  useEffect(() => {
    if (partnerId) {
      const p = lobbyPeers.find(x => x.id === partnerId);
      if (p) setPartnerName(p.name);
    }
  }, [partnerId, lobbyPeers]);

  return {
    pairingState,
    lobbyPeers,
    pairRequest,
    connect: () => adapterRef.current?.connect(),
    disconnect: () => adapterRef.current?.disconnect(),
    requestPair: (id) => adapterRef.current?.requestPair(id),
    acceptPair: () => pairRequest && adapterRef.current?.acceptPair(pairRequest.fromId),
    rejectPair: () => pairRequest && adapterRef.current?.rejectPair(pairRequest.fromId),
    unpair: () => adapterRef.current?.unpair(),
    partnerId,
    partnerName,
    peerDownloadSpeed,
    peerUploadSpeed,
    peerTestState,
    peerDownloadHistory,
    peerUploadHistory,
    adapter,
    error
  };
}
