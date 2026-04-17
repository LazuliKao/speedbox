# speedbox

轻量级 LAN speedtest 工具，后端使用 Rust，前端使用 Preact。

## 功能

- HTTP 下载/上传测速
- WebSocket 测速（可选）
- WebRTC 信令（可选）
- 面向 OpenWrt/嵌入式场景的轻量部署

## 本地开发

### 后端

```bash
cargo build
cargo test
cargo run
```

默认监听 `0.0.0.0:8080`，可通过环境变量配置：

- `SPEEDBOX_PORT`
- `SPEEDBOX_BIND`

### 前端

```bash
cd web
pnpm install
pnpm dev
```

默认地址：`http://localhost:5173`，可通过 `?api=http://localhost:8080` 指向后端。

## Docker

仓库提供一个多阶段 `Dockerfile`，支持两种运行时目标：

- `runtime-distroless`
- `runtime-alpine`

### 本地构建镜像

```bash
# distroless
docker build --target runtime-distroless -t speedbox:distroless .

# alpine
docker build --target runtime-alpine -t speedbox:alpine .
```

### 运行镜像

```bash
docker run --rm -p 8080:8080 speedbox:distroless
# 或
# docker run --rm -p 8080:8080 speedbox:alpine
```

## GitHub Actions + GHCR

新增 workflow：`.github/workflows/docker.yml`

触发条件：

- push 到 `main`
- push tag（`v*`）
- 手动触发（`workflow_dispatch`）

workflow 会自动：

- 构建 `distroless` 与 `alpine` 两种镜像
- 构建多架构镜像（`linux/amd64`, `linux/arm64`）
- 推送到 `ghcr.io/<owner>/speedbox`

示例标签（按分支/标签/SHA 自动生成，并附带 `-distroless` 或 `-alpine` 后缀）：

- `ghcr.io/<owner>/speedbox:main-distroless`
- `ghcr.io/<owner>/speedbox:main-alpine`
- `ghcr.io/<owner>/speedbox:v0.1.0-distroless`
- `ghcr.io/<owner>/speedbox:sha-xxxxxxx-alpine`

## 测试联调建议

联调时请分别启动后端与前端：

```bash
# 终端 1
cargo run

# 终端 2
cd web
pnpm dev
```

浏览器访问：

`http://localhost:5173/?api=http://localhost:8080`

若需验证 `arm64` 镜像，建议在目标 ARM64 设备（如 OpenWrt ARM 板卡）直接拉取并运行 GHCR 镜像后再联调，例如：

```bash
docker run --rm -p 8080:8080 ghcr.io/<owner>/speedbox:main-alpine
```
