# syntax=docker/dockerfile:1.7

FROM rust:1.88-alpine AS builder
WORKDIR /app

RUN apk add --no-cache musl-dev

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release && cp target/release/speedbox /tmp/speedbox

FROM gcr.io/distroless/static-debian12:nonroot@sha256:a9329520abc449e3b14d5bc3a6ffae065bdde0f02667fa10880c49b35c109fd1 AS runtime-distroless
COPY --from=builder /tmp/speedbox /usr/local/bin/speedbox
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/speedbox"]

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS runtime-alpine
RUN addgroup -S speedbox && adduser -S -u 10001 -G speedbox speedbox
COPY --from=builder /tmp/speedbox /usr/local/bin/speedbox
USER speedbox
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/speedbox"]
