export { HttpAdapter } from './adapters/http';
export { WebSocketAdapter } from './adapters/websocket';
export { WebRtcAdapter } from './adapters/webrtc';
export {
  type SpeedTestAdapter,
  type SpeedTestConfig,
  type SpeedTestCallbacks,
  type SpeedProgress,
  type HistoryPoint,
  type TestDirection,
  type TestMode,
  type TestState,
  DEFAULT_CONFIG,
  apiBase,
  setApiBase,
  clearApiBase,
} from './speedtest';
