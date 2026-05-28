import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import {
  WebRtcAdapter,
  type PairingState,
  type LobbyPeer,
  type PairRequest,
  type WebRtcEvents,
} from '../lib/adapters/webrtc';
import { apiBase } from '../lib/speedtest';
import type {
  SpeedTestConfig,
  TestDirection,
  HistoryPoint,
  TestState,
} from '../lib/speedtest';

const getSignalingUrl = (): string => {
  const base = apiBase();
  if (base) {
    return base.replace(/^http/, 'ws') + '/ws/signal';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/signal`;
};

export interface UseWebRtcPairingReturn {
  pairingState: PairingState;
  lobbyPeers: LobbyPeer[];
    pairRequest: PairRequest | null;
    deviceName: string | null;
  
  connect: () => void;
  disconnect: () => void;
  requestPair: (targetId: string) => void;
  acceptPair: () => void;
  rejectPair: () => void;
  unpair: () => void;
  
  partnerId: string | null;
  partnerName: string | null;
  
  // Remote peer's progress (what they are doing)
  peerDownloadSpeed: number;
  peerUploadSpeed: number;
  peerTestState: TestState;
  peerDownloadHistory: HistoryPoint[];
  peerUploadHistory: HistoryPoint[];
  
  // Local progress (what WE are doing in response to peer's test)
  localDownloadSpeed: number;
  localUploadSpeed: number;
  localDownloadHistory: HistoryPoint[];
  localUploadHistory: HistoryPoint[];
  localPassiveState: TestState;
  
  resetPeerState: () => void;

  adapter: WebRtcAdapter | null;
  error: string | null;
  getDebugInfo: () => any;
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

  // Local progress state
  const [localDownloadSpeed, setLocalDownloadSpeed] = useState(0);
  const [localUploadSpeed, setLocalUploadSpeed] = useState(0);
  const [localDownloadHistory, setLocalDownloadHistory] = useState<HistoryPoint[]>([]);
  const [localUploadHistory, setLocalUploadHistory] = useState<HistoryPoint[]>([]);
  const [localPassiveState, setLocalPassiveState] = useState<TestState>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const adapterRef = useRef<WebRtcAdapter | null>(null);
  const [adapter, setAdapter] = useState<WebRtcAdapter | null>(null);

  const doLocalReset = useCallback(() => {
    setPeerTestState('idle');
    setPeerDownloadSpeed(0);
    setPeerUploadSpeed(0);
    setPeerDownloadHistory([]);
    setPeerUploadHistory([]);
    setLocalDownloadSpeed(0);
    setLocalUploadSpeed(0);
    setLocalDownloadHistory([]);
    setLocalUploadHistory([]);
    setLocalPassiveState('idle');
    setError(null);
  }, []);

  const handlePeerTestStart = useCallback((config: SpeedTestConfig & { initiatorDirection: TestDirection; phase: number }) => {
    const remoteDirection = config.initiatorDirection;
    const phase = config.phase ?? 1;
    setPeerTestState(remoteDirection === 'download' ? 'downloading' : 'uploading');

    if (phase === 1) {
      setPeerDownloadSpeed(0);
      setPeerUploadSpeed(0);
      setPeerDownloadHistory([]);
      setPeerUploadHistory([]);
      setLocalDownloadSpeed(0);
      setLocalUploadSpeed(0);
      setLocalDownloadHistory([]);
      setLocalUploadHistory([]);
    }

    const localDirection = remoteDirection === 'download' ? 'upload' : 'download';

    if (adapterRef.current) {
      adapterRef.current.startRemote(localDirection, config, {
        onProgress: (dir, progress) => {
          const speed = progress.speedMbps ?? 0;
          if (dir === 'download') {
            setLocalDownloadSpeed(speed);
            setLocalDownloadHistory(prev => [...prev, { t: progress.elapsed, v: speed }]);
          } else {
            setLocalUploadSpeed(speed);
            setLocalUploadHistory(prev => [...prev, { t: progress.elapsed, v: speed }]);
          }
        },
        onStateChange: (s) => setLocalPassiveState(s),
        onError: () => {}
      });
    }
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
          doLocalReset();
        }
      },
      onLobbyUpdate: (peers) => {
        setLobbyPeers(peers);
      },
      onPeerLeft: (peerId) => {
        setLobbyPeers((prev) => prev.filter((p) => p.id !== peerId));
      },
      onPairRequest: (req) => {
        setPairRequest(req);
      },
      onPaired: (pid, name) => {
        setPartnerId(pid);
        setPartnerName(name);
        setPairRequest(null);
        setError(null);
      },
      onUnpaired: () => {
        setPartnerId(null);
        setPartnerName(null);
        setPeerTestState('idle');
      },
      onPeerTestStart: (config) => {
        handlePeerTestStart(config);
      },
      onPeerTestStop: () => {
        setPeerTestState('idle');
      },
      onPeerTestReset: () => {
        doLocalReset();
      },
      onPeerTestUpdate: (progress) => {
        const speed = progress.speedMbps ?? progress.speed ?? 0;
        if (progress.direction === 'download') {
          setPeerDownloadSpeed(speed);
          setPeerDownloadHistory(prev => [...prev, { t: progress.elapsed, v: speed }]);
        } else {
          setPeerUploadSpeed(speed);
          setPeerUploadHistory(prev => [...prev, { t: progress.elapsed, v: speed }]);
        }
      },
      onError: (err) => {
        setError(err);
      }
    };

    const inst = new WebRtcAdapter(events);
    adapterRef.current = inst;
    setAdapter(inst);
    setDeviceName(inst.getDebugInfo().deviceName);
    inst.connect(getSignalingUrl());
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
    connect: () => adapterRef.current?.connect(getSignalingUrl()),
    disconnect: () => adapterRef.current?.disconnect(),
    requestPair: (id) => {
      console.log('[HOOK] requestPair called with id:', id, 'adapter:', !!adapterRef.current);
      adapterRef.current?.requestPair(id);
    },
    acceptPair: () => pairRequest && adapterRef.current?.acceptPair(pairRequest.fromId),
    rejectPair: () => {
      if (pairRequest) adapterRef.current?.rejectPair(pairRequest.fromId);
      setPairRequest(null);
    },
    unpair: () => adapterRef.current?.unpair(),
    partnerId,
    partnerName,
    deviceName,
    peerDownloadSpeed,
    peerUploadSpeed,
    peerTestState,
    peerDownloadHistory,
    peerUploadHistory,
    localDownloadSpeed,
    localUploadSpeed,
    localDownloadHistory,
    localUploadHistory,
    localPassiveState,
    resetPeerState: () => {
      doLocalReset();
      adapterRef.current?.sendTestReset();
    },
    adapter,
    getDebugInfo: () => adapterRef.current?.getDebugInfo(),
    error
  };
}
