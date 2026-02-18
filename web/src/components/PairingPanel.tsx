import { type FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { type PairingState, type LobbyPeer, type PairRequest } from '../lib/adapters/webrtc';

interface DebugInfo {
  deviceId: string;
  deviceName: string;
  pairingState: PairingState;
  partnerId: string | null;
  partnerName: string | null;
  wsReadyState: number | undefined;
  wsUrl: string | undefined;
  hasPeerConnection: boolean;
  peerConnectionState: string | undefined;
  iceConnectionState: string | undefined;
  hasDataChannel: boolean;
  dataChannelState: string | undefined;
  bytesReceived: number;
  bytesSent: number;
  recentMessages: string[];
}

interface PairingPanelProps {
  pairingState: PairingState;
  lobbyPeers: LobbyPeer[];
  pairRequest: PairRequest | null;
  partnerName: string | null;
  deviceName?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRequestPair: (targetId: string) => void;
  onAcceptPair: () => void;
  onRejectPair: () => void;
  onUnpair: () => void;
  disabled?: boolean;
  getDebugInfo?: () => DebugInfo | null;
}

export const PairingPanel: FunctionalComponent<PairingPanelProps> = ({
  pairingState,
  lobbyPeers,
  pairRequest,
  partnerName,
  deviceName,
  onConnect,
  onDisconnect,
  onRequestPair,
  onAcceptPair,
  onRejectPair,
  onUnpair,
  disabled,
  getDebugInfo
}) => {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const handleInfoClick = () => {
    if (getDebugInfo) {
      setDebugInfo(getDebugInfo());
      setShowDebugInfo(true);
    }
  };

  const handleCloseModal = () => {
    setShowDebugInfo(false);
  };

  const handleRequest = (id: string) => {
    setPendingId(id);
    onRequestPair(id);
  };
  
  if (pairingState !== 'pending' && pendingId) {
      setPendingId(null);
  }

  let content;

  if (pairingState === 'disconnected') {
    content = (
      <div class="pairing-panel pairing-panel--disconnected">
        <button class="start-button" onClick={onConnect} disabled={disabled}>
          Connect to Nearby Devices
        </button>
      </div>
    );
  } else if (pairingState === 'paired') {
    content = (
      <div class="pairing-panel pairing-panel--paired">
        <div class="paired-status">
          <div class="paired-icon">✓</div>
          <div class="paired-info">
            <span class="paired-label">Paired with</span>
            <span class="paired-name">{partnerName || 'Unknown Device'}</span>
          </div>
          {getDebugInfo && (
            <button class="debug-info-icon" onClick={handleInfoClick} title="View connection details">
              ℹ
            </button>
          )}
        </div>
        <button class="reset-button" onClick={onUnpair} disabled={disabled}>
          Unpair
        </button>
      </div>
    );
  } else if (pairingState === 'pending') {
     const targetName = lobbyPeers.find(p => p.id === pendingId)?.name || 'device';
     content = (
        <div class="pairing-panel pairing-panel--pending">
            <div class="pair-request-content">
               <span class="spinner"></span>
               <p>Waiting for <strong>{targetName}</strong> to accept...</p>
               <button class="backend-config__cancel" onClick={onDisconnect}>Cancel</button>
            </div>
        </div>
     );
  } else {
    content = (
      <div class="pairing-panel pairing-panel--lobby">
        {deviceName && (
          <div class="device-name-display" style="padding: 8px 12px; background: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 6px; margin-bottom: 12px;">
            <span style="color: #4ade80; font-weight: 600;">Your Device: </span>
            <span style="color: #fff;">{deviceName}</span>
          </div>
        )}
        <div class="lobby-header">
          <h3>Nearby Devices ({lobbyPeers.length})</h3>
          <button class="backend-config__cancel" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>

        <div class="lobby-list">
          {lobbyPeers.length === 0 ? (
            <div class="lobby-empty">
              <span class="spinner"></span>
              Waiting for other devices...
            </div>
          ) : (
            lobbyPeers.map(peer => (
              <div key={peer.id} class="lobby-peer">
                <span class="peer-name">{peer.name}</span>
                <button
                  class="backend-config__save"
                  onClick={() => handleRequest(peer.id)}
                  disabled={disabled}
                >
                  Pair
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="pairing-container">
      {content}

      {pairRequest && (
        <div class="pair-request-modal">
          <div class="pair-request-content">
            <h4>Pair Request</h4>
            <p><strong>{pairRequest.fromName}</strong> wants to pair with you.</p>
            <div class="pair-actions">
              <button class="start-button" onClick={onAcceptPair}>Accept</button>
              <button class="stop-button" onClick={onRejectPair}>Reject</button>
            </div>
          </div>
        </div>
      )}

      {showDebugInfo && debugInfo && (
        <div class="pair-request-modal" onClick={handleCloseModal}>
          <div class="pair-request-content debug-info-modal" onClick={e => e.stopPropagation()}>
            <h4>WebRTC Connection Info</h4>
            <div class="debug-info-grid">
              <div class="debug-row">
                <span class="debug-label">Device ID:</span>
                <span class="debug-value">{debugInfo.deviceId.slice(0, 8)}...</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Device Name:</span>
                <span class="debug-value">{debugInfo.deviceName}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Partner ID:</span>
                <span class="debug-value">{debugInfo.partnerId?.slice(0, 8) || 'N/A'}...</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Partner Name:</span>
                <span class="debug-value">{debugInfo.partnerName || 'N/A'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">WebSocket:</span>
                <span class="debug-value">{debugInfo.wsReadyState === 1 ? 'Connected' : 'Disconnected'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">PeerConnection:</span>
                <span class="debug-value">{debugInfo.peerConnectionState || 'N/A'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">ICE State:</span>
                <span class="debug-value">{debugInfo.iceConnectionState || 'N/A'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">DataChannel:</span>
                <span class="debug-value">{debugInfo.dataChannelState || 'N/A'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Bytes Received:</span>
                <span class="debug-value">{((debugInfo.bytesReceived || 0) / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Bytes Sent:</span>
                <span class="debug-value">{((debugInfo.bytesSent || 0) / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div class="debug-row" style="flex-direction: column; align-items: flex-start;">
                <span class="debug-label">Recent Messages:</span>
                <div style="font-family: monospace; font-size: 11px; max-height: 100px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 4px; margin-top: 4px; width: 100%;">
                  {debugInfo.recentMessages.length === 0 ? (
                    <span style="color: #666;">No messages yet</span>
                  ) : (
                    debugInfo.recentMessages.map((msg, i) => (
                      <div key={i} style={{ color: msg.includes('TEST_START') ? '#4ade80' : msg.includes('ERROR') ? '#f87171' : '#fff' }}>
                        {msg}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div class="pair-actions">
              <button class="backend-config__save" onClick={handleCloseModal}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
