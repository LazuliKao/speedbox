import { type FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { type PairingState, type LobbyPeer, type PairRequest } from '../lib/adapters/webrtc';

interface PairingPanelProps {
  pairingState: PairingState;
  lobbyPeers: LobbyPeer[];
  pairRequest: PairRequest | null;
  partnerName: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRequestPair: (targetId: string) => void;
  onAcceptPair: () => void;
  onRejectPair: () => void;
  onUnpair: () => void;
  disabled?: boolean;
}

export const PairingPanel: FunctionalComponent<PairingPanelProps> = ({
  pairingState,
  lobbyPeers,
  pairRequest,
  partnerName,
  onConnect,
  onDisconnect,
  onRequestPair,
  onAcceptPair,
  onRejectPair,
  onUnpair,
  disabled
}) => {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleRequest = (id: string) => {
    setPendingId(id);
    onRequestPair(id);
  };
  
  if (pairingState !== 'pair_pending' && pendingId) {
      setPendingId(null);
  }

  if (pairingState === 'disconnected') {
    return (
      <div class="pairing-panel pairing-panel--disconnected">
        <button class="start-button" onClick={onConnect} disabled={disabled}>
          Connect to Nearby Devices
        </button>
      </div>
    );
  }

  if (pairingState === 'paired') {
    return (
      <div class="pairing-panel pairing-panel--paired">
        <div class="paired-status">
          <div class="paired-icon">✓</div>
          <div class="paired-info">
            <span class="paired-label">Paired with</span>
            <span class="paired-name">{partnerName || 'Unknown Device'}</span>
          </div>
        </div>
        <button class="reset-button" onClick={onUnpair} disabled={disabled}>
          Unpair
        </button>
      </div>
    );
  }
  
  if (pairingState === 'pair_pending') {
     const targetName = lobbyPeers.find(p => p.id === pendingId)?.name || 'device';
     return (
        <div class="pairing-panel pairing-panel--pending">
            <div class="pair-request-content">
               <span class="spinner"></span>
               <p>Waiting for <strong>{targetName}</strong> to accept...</p>
               <button class="backend-config__cancel" onClick={onDisconnect}>Cancel</button>
            </div>
        </div>
     );
  }

  return (
    <div class="pairing-panel pairing-panel--lobby">
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
    </div>
  );
};
