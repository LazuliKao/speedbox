use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

/// Start the speedbox server on a random port and return the address and handle.
async fn start_server() -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let buffer = Arc::new(speedbox::data::generate_buffer());

    let handle = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let io = hyper_util::rt::TokioIo::new(stream);
            let buffer = buffer.clone();

            tokio::task::spawn(async move {
                let service = hyper::service::service_fn(move |req| {
                    let buffer = buffer.clone();
                    speedbox::route(req, buffer)
                });

                let conn = hyper::server::conn::http1::Builder::new().serve_connection(io, service);

                #[cfg(feature = "ws")]
                let conn = conn.with_upgrades();

                if let Err(e) = conn.await {
                    eprintln!("connection error: {e}");
                }
            });
        }
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(50)).await;

    (addr, handle)
}

/// Build a client with short timeout (for infinite-stream endpoints).
fn short_timeout_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap()
}

async fn write_ws_frame<S>(stream: &mut S, opcode: u8, payload: &[u8])
where
    S: AsyncWrite + Unpin,
{
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | opcode);

    match payload.len() {
        len @ 0..=125 => frame.push(0x80 | len as u8),
        len @ 126..=65535 => {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        }
        len => {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }
    }

    let mask = [0x12, 0x34, 0x56, 0x78];
    frame.extend_from_slice(&mask);
    frame.extend(
        payload
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ mask[index % 4]),
    );

    stream.write_all(&frame).await.unwrap();
    stream.flush().await.unwrap();
}

async fn read_ws_frame<S>(stream: &mut S) -> Option<(u8, Vec<u8>)>
where
    S: AsyncRead + Unpin,
{
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await.ok()?;

    let opcode = header[0] & 0x0f;
    let masked = header[1] & 0x80 != 0;
    let mut payload_len = (header[1] & 0x7f) as u64;

    if payload_len == 126 {
        let mut len = [0u8; 2];
        stream.read_exact(&mut len).await.ok()?;
        payload_len = u16::from_be_bytes(len) as u64;
    } else if payload_len == 127 {
        let mut len = [0u8; 8];
        stream.read_exact(&mut len).await.ok()?;
        payload_len = u64::from_be_bytes(len);
    }

    let mut mask = [0u8; 4];
    if masked {
        stream.read_exact(&mut mask).await.ok()?;
    }

    let mut payload = vec![0u8; payload_len as usize];
    stream.read_exact(&mut payload).await.ok()?;

    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }

    Some((opcode, payload))
}

#[tokio::test]
async fn test_info_endpoint() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/info");

    let resp = reqwest::get(&url).await.unwrap();
    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["version"].is_string());
    assert!(body["features"].is_array());
}

#[tokio::test]
async fn test_download_endpoint() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/download");

    // Download streams infinite data; use timeout client and only check headers + partial body
    let client = short_timeout_client();
    let mut resp = client.get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "application/octet-stream"
    );

    // Read a chunk then abort (body is infinite)
    let chunk = resp.chunk().await.unwrap();
    assert!(chunk.is_some());
    assert!(!chunk.unwrap().is_empty());
}

#[tokio::test]
async fn test_download_with_chunk_size() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/download?chunk_size=1024");

    let client = short_timeout_client();
    let mut resp = client.get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 200);

    let chunk = resp.chunk().await.unwrap();
    assert!(chunk.is_some());
}

#[tokio::test]
async fn test_upload_endpoint() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/upload");

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("content-type", "application/octet-stream")
        .body(vec![0u8; 1024])
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let body = resp.text().await.unwrap();
    assert_eq!(body, "received=1024");
}

#[tokio::test]
async fn test_cors_headers() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/info");

    let resp = reqwest::get(&url).await.unwrap();
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "*"
    );
}

#[tokio::test]
async fn test_not_found() {
    let (addr, _handle) = start_server().await;
    let url = format!("http://{addr}/nonexistent");

    let resp = reqwest::get(&url).await.unwrap();
    assert_eq!(resp.status(), 404);
}

#[cfg(feature = "ws")]
mod ws_tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn test_websocket_upgrade() {
        let (addr, _handle) = start_server().await;
        let url = format!("ws://{addr}/ws/speed");

        let result = connect_async(&url).await;
        assert!(result.is_ok(), "WebSocket upgrade should succeed");
    }

    #[tokio::test]
    async fn test_websocket_download() {
        let (addr, _handle) = start_server().await;
        let url = format!("ws://{addr}/ws/speed");
        let (mut ws, _) = connect_async(&url).await.unwrap();
        let stream = ws.get_mut();

        write_ws_frame(stream, 0x1, b"download").await;

        let received_binary = timeout(Duration::from_secs(1), async {
            loop {
                let Some((opcode, payload)) = read_ws_frame(stream).await else {
                    return false;
                };
                match opcode {
                    0x2 if !payload.is_empty() => return true,
                    0x8 => return false,
                    _ => {}
                }
            }
        })
        .await
        .unwrap_or(false);

        assert!(received_binary, "expected at least one binary frame");

        write_ws_frame(stream, 0x8, &[]).await;
    }

    #[tokio::test]
    async fn test_websocket_upload() {
        let (addr, _handle) = start_server().await;
        let url = format!("ws://{addr}/ws/speed");
        let (mut ws, _) = connect_async(&url).await.unwrap();
        let stream = ws.get_mut();

        write_ws_frame(stream, 0x1, b"upload").await;

        let payloads = [vec![1u8; 128], vec![2u8; 256], vec![3u8; 512]];
        let expected_total: usize = payloads.iter().map(Vec::len).sum();

        for payload in payloads {
            write_ws_frame(stream, 0x2, &payload).await;
        }

        stream.shutdown().await.unwrap();

        let response = timeout(Duration::from_secs(1), async {
            loop {
                let (opcode, payload) = read_ws_frame(stream).await?;
                if opcode == 0x1 {
                    return Some(String::from_utf8(payload).unwrap());
                }
            }
        })
        .await
        .unwrap();

        let expected = format!("received={expected_total}");
        assert_eq!(response.as_deref(), Some(expected.as_str()));
    }
}

#[cfg(feature = "webrtc")]
mod signaling_tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn test_signaling_hello_and_lobby() {
        let (addr, _handle) = start_server().await;
        let url = format!("ws://{addr}/ws/signal");
        let (mut ws, _) = connect_async(&url).await.unwrap();
        let stream = ws.get_mut();

        write_ws_frame(stream, 0x1, br#"HELLO {"id":"test1","name":"Tester"}"#).await;

        let hello = timeout(Duration::from_secs(1), async {
            loop {
                let (opcode, payload) = read_ws_frame(stream).await?;
                if opcode == 0x1 {
                    return Some(String::from_utf8(payload).unwrap());
                }
            }
        })
        .await
        .unwrap();

        assert_eq!(hello.as_deref(), Some("HELLO_OK"));

        let lobby = timeout(Duration::from_secs(1), async {
            loop {
                let (opcode, payload) = read_ws_frame(stream).await?;
                if opcode == 0x1 {
                    let text = String::from_utf8(payload).unwrap();
                    if text.starts_with("LOBBY ") {
                        return Some(text);
                    }
                }
            }
        })
        .await
        .unwrap();

        let lobby = lobby.expect("expected lobby update");
        assert_eq!(lobby, "LOBBY []");

        write_ws_frame(stream, 0x8, &[]).await;
        sleep(Duration::from_millis(50)).await;
    }
}
