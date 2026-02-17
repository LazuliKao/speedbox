//! WebSocket speed test protocol handler.
//!
//! Activated by the `ws` Cargo feature.
//!
//! Protocol:
//! - Client connects to `/ws/speed`.
//! - Client sends a text command: `"download"` or `"upload"`.
//! - **Download mode**: Server floods binary frames from the shared buffer until
//!   the client closes the connection.
//! - **Upload mode**: Server reads binary frames sent by the client and, on
//!   close, replies with a text frame containing the total byte count.

use std::sync::Arc;

use bytes::Bytes;
use fastwebsockets::{upgrade, Frame, OpCode, WebSocketError};
use http_body_util::Empty;
use hyper::body::Incoming;
use hyper::{Request, Response};

use crate::data;

/// Upgrade the HTTP request to a WebSocket and spawn the speed test handler.
///
/// Returns the HTTP 101 Switching Protocols response to hyper.
pub async fn handle_ws_speed(
    mut req: Request<Incoming>,
    buffer: Arc<Vec<u8>>,
) -> Result<Response<Empty<Bytes>>, WebSocketError> {
    let (response, fut) = upgrade::upgrade(&mut req)?;

    // Spawn the WebSocket handler so we can return the 101 immediately.
    tokio::task::spawn(async move {
        if let Err(e) = handle_ws_connection(fut, buffer).await {
            eprintln!("ws speed error: {e}");
        }
    });

    Ok(response)
}

async fn handle_ws_connection(
    fut: upgrade::UpgradeFut,
    buffer: Arc<Vec<u8>>,
) -> Result<(), WebSocketError> {
    let mut ws = fut.await?;
    ws.set_auto_close(true);
    ws.set_auto_pong(true);

    // Wait for the client to send a command (text frame).
    let cmd_frame = ws.read_frame().await?;
    let cmd = match cmd_frame.opcode {
        OpCode::Text => String::from_utf8_lossy(&cmd_frame.payload).to_string(),
        OpCode::Close => return Ok(()),
        _ => {
            // Unexpected frame type — close with protocol error.
            ws.write_frame(Frame::close(1002, b"expected text command"))
                .await?;
            return Ok(());
        }
    };

    match cmd.trim() {
        "download" => ws_download(&mut ws, &buffer).await,
        "upload" => ws_upload(&mut ws).await,
        _ => {
            ws.write_frame(Frame::close(1002, b"unknown command"))
                .await?;
            Ok(())
        }
    }
}

/// Download mode: flood binary frames until the client disconnects.
async fn ws_download(
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
    buffer: &[u8],
) -> Result<(), WebSocketError> {
    let chunk_size = data::DEFAULT_CHUNK_SIZE;
    let buf_len = buffer.len();
    let mut offset = 0;

    loop {
        let end = (offset + chunk_size).min(buf_len);
        let chunk = &buffer[offset..end];

        match ws
            .write_frame(Frame::binary(fastwebsockets::Payload::Borrowed(chunk)))
            .await
        {
            Ok(()) => {}
            Err(WebSocketError::ConnectionClosed) => break,
            Err(e) => {
                // Broken pipe, reset, etc. — client went away.
                eprintln!("ws download write error: {e}");
                break;
            }
        }

        offset = end;
        if offset >= buf_len {
            offset = 0;
        }
    }

    Ok(())
}

/// Upload mode: consume binary frames, then report total bytes received.
async fn ws_upload(
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
) -> Result<(), WebSocketError> {
    let mut total: u64 = 0;

    loop {
        match ws.read_frame().await {
            Ok(frame) => match frame.opcode {
                OpCode::Binary => {
                    total += frame.payload.len() as u64;
                }
                OpCode::Close => break,
                _ => {} // ignore pings, pongs, text
            },
            Err(WebSocketError::ConnectionClosed) => break,
            Err(e) => {
                eprintln!("ws upload read error: {e}");
                break;
            }
        }
    }

    // Best-effort: send result (client may already be gone).
    let msg = format!("received={total}");
    let _ = ws
        .write_frame(Frame::text(fastwebsockets::Payload::Owned(
            msg.into_bytes(),
        )))
        .await;

    Ok(())
}
