import { type FunctionalComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { apiBase } from '../lib/speedtest';

export type Protocol = 'http' | 'ws' | 'webrtc';

interface ProtocolSelectorProps {
  selected: Protocol;
  onSelect: (protocol: Protocol) => void;
  roomId: string;
  onRoomIdChange: (id: string) => void;
  disabled?: boolean;
}

export const ProtocolSelector: FunctionalComponent<ProtocolSelectorProps> = ({
  selected,
  onSelect,
  roomId,
  onRoomIdChange,
  disabled,
}) => {
  const [features, setFeatures] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${apiBase()}/info`)
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.features)) {
          setFeatures(data.features);
        }
      })
      .catch((err) => console.error('Failed to fetch capabilities', err));
  }, []);

  const protocols: { id: Protocol; label: string }[] = [
    { id: 'http', label: 'HTTP' },
    { id: 'ws', label: 'WebSocket' },
    { id: 'webrtc', label: 'WebRTC' },
  ];

  return (
    <div class="protocol-selector-container">
      <div class="protocol-selector">
        {protocols.map((p) => {
          const isAvailable = features.length === 0 || features.includes(p.id);
          return (
            <button
              key={p.id}
              class={`protocol-tab ${selected === p.id ? 'protocol-tab--active' : ''} ${
                !isAvailable ? 'protocol-tab--disabled' : ''
              }`}
              onClick={() => isAvailable && onSelect(p.id)}
              disabled={disabled || !isAvailable}
              title={!isAvailable ? 'Not supported by server' : ''}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {selected === 'webrtc' && (
        <div class="webrtc-settings">
          <input
            type="text"
            class="room-id-input"
            placeholder="Enter Room ID"
            value={roomId}
            onInput={(e) => onRoomIdChange((e.target as HTMLInputElement).value)}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};
