# Speedbox - AGENTS.md

Multi-protocol LAN speed test tool with Rust backend and Preact frontend.

## Project Overview

- **Backend**: Rust HTTP/WebSocket server using hyper 1.0 + tokio + fastwebsockets
- **Frontend**: Preact 10 + TypeScript + Vite 6
- **Purpose**: Lightweight speed test for OpenWrt/embedded devices

---

## Build Commands

### Backend (Rust)

```bash
# Development build (all features)
cargo build

# Production build (optimized, minimal size)
cargo build --release

# HTTP-only build (no WebSocket/WebRTC)
cargo build --no-default-features

# Run backend server
cargo run
# Listens on 0.0.0.0:8080 by default

# Run specific test
cargo test <test_name>

# Run all tests
cargo test
```

### Frontend (Preact)

```bash
cd web

# Development server with proxy to backend
pnpm dev
# Runs on http://localhost:5173

# Production build (outputs to ../package/luci-app-speedbox/root/www/speedbox)
pnpm build

# Run tests
pnpm test

# Type check only
npx tsc --noEmit
```

---

## Project Structure

```
speedbox/
├── src/                    # Rust backend
│   ├── main.rs            # Entry point, routing
│   ├── config.rs          # Configuration (bind addr, port)
│   ├── data.rs            # Download buffer generation
│   └── protocol/          # Protocol handlers
│       ├── mod.rs
│       ├── http.rs        # HTTP download/upload
│       ├── ws.rs          # WebSocket speed test
│       └── signaling.rs   # WebRTC signaling server
├── web/                    # Preact frontend
│   └── src/
│       ├── index.tsx      # Entry point
│       ├── app.tsx        # Main app component
│       ├── Gauge.tsx      # Speed gauge SVG
│       ├── Chart.tsx      # Speed history chart
│       ├── components/    # UI components
│       │   ├── AdvancedSettings.tsx
│       │   ├── ProtocolSelector.tsx
│       │   └── BackendConfig.tsx
│       ├── hooks/         # Preact hooks
│       │   └── useSpeedTestAdapter.ts
│       └── lib/           # Core logic
│           ��── speedtest.ts    # Types, interfaces, helpers
│           ├── index.ts        # Re-exports
│           └── adapters/       # Protocol implementations
│               ├── http.ts
│               ├── websocket.ts
│               └── webrtc.ts
└── package/               # OpenWrt package files
```

---

## Code Style Guidelines

### TypeScript/Preact

**Imports**: Use type-only imports for types. Group imports: external → internal.

```typescript
// Good
import { type FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { Gauge } from './Gauge';
import type { SpeedTestConfig } from './lib/speedtest';
```

**Components**: Use `FunctionalComponent` type. Use `class` (not `className`).

```typescript
// Good
export const MyComponent: FunctionalComponent<Props> = ({ value }) => (
  <div class="my-component">{value}</div>
);
```

**Types**: Use `type` for unions/aliases, `interface` for objects. Export all public types.

```typescript
// Good
export type TestDirection = 'download' | 'upload';
export interface SpeedProgress { totalBytes: number; elapsed: number; }
```

**Naming**: PascalCase for components/types, camelCase for functions/variables, UPPER_SNAKE for constants.

**Error Handling**: Never catch and swallow errors silently. Always propagate or log.

```typescript
// Bad
try { doSomething(); } catch {}

// Good
try { doSomething(); } catch (e) { onError(String(e)); }
```

**Strict Rules**: TypeScript strict mode is enabled. No `as any`, `@ts-ignore`, or `@ts-expect-error`.

### Rust

**Imports**: Group by external → internal. Use `use crate::` for local modules.

**Error Handling**: Use `Result<T, E>`, propagate with `?`, never panic in production code.

**Conditional Compilation**: Use `#[cfg(feature = "...")]` for optional features.

```rust
#[cfg(feature = "ws")]
if path == "/ws/speed" {
    return protocol::ws::handle_ws_speed(req, buffer).await;
}
```

**Comments**: Use `///` for public API docs, `//` for implementation notes.

---

## Key Patterns

### SpeedTestAdapter Interface

All protocol implementations share this interface:

```typescript
interface SpeedTestAdapter {
  readonly name: string;
  start(direction: TestDirection, config: SpeedTestConfig, callbacks: SpeedTestCallbacks): Promise<void>;
  stop(): void;
  destroy(): void;
}
```

### Backend Configuration

Frontend can configure backend address via:
1. URL parameter: `?api=http://192.168.1.100:8080`
2. localStorage (set via UI)
3. Window global: `window.SPEEDBOX_API_BASE`

### CORS

Backend returns CORS headers on all responses. No authentication required.

---

## Testing

- **Backend**: Unit tests in `#[cfg(test)]` modules within each `.rs` file
- **Frontend**: Vitest tests in `web/test/` directory (if exists)
- **E2E**: Use Playwright for browser testing against running servers

---

## Conditional Features

| Feature | Description | Dependencies |
|---------|-------------|--------------|
| `ws` | WebSocket speed test | fastwebsockets |
| `webrtc` | WebRTC signaling server | fastwebsockets |

Default: both features enabled. Build with `--no-default-features` for HTTP-only minimal binary.

---

## Architecture Notes

- **Decoupled Adapters**: HTTP, WebSocket, WebRTC adapters are independent. No shared state.
- **P2P WebRTC**: Peers connect via signaling server at `/ws/signal`. Room-based discovery.
- **Streaming**: Backend streams infinite data for download tests; client aborts after duration.
- **OpenWrt Target**: Release build optimized for size (`opt-level = "s"`, LTO, strip).
