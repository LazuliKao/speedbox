//! WebRTC signaling relay (room-based message forwarding).
//!
//! Activated by the `webrtc` Cargo feature.
//!
//! ## Protocol (text-based, no serde):
//! - Client sends: `JOIN <room_id>` → joins a room (max 2 peers)
//! - Client sends: `LEAVE` → leaves current room
//! - Client sends: `SIGNAL <payload>` → forwards payload to the other peer in room
//! - Server sends: `JOINED <role>` → confirms join, role is `host` or `client`
//! - Server sends: `PEER_JOINED` → notifies existing peer that a second peer joined
//! - Server sends: `PEER_LEFT` → notifies remaining peer that the other left
//! - Server sends: `SIGNAL <payload>` → forwarded signal from the other peer
//! - Server sends: `ERROR <msg>` → error message
//! - Server sends: `ROOMS <json>` → room list (response to `LIST`)
//! - Client sends: `LIST` → request available rooms

use std::collections::HashMap;
use std::sync::Arc;

use bytes::Bytes;
use fastwebsockets::upgrade;
use fastwebsockets::{Frame, OpCode, WebSocketError};
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Request, Response};
use tokio::sync::{mpsc, RwLock};

/// A peer in a signaling room.
struct Peer {
    tx: mpsc::UnboundedSender<String>,
}

/// A signaling room (max 2 peers: host + client).
struct Room {
    host: Peer,
    client: Option<Peer>,
}

type Rooms = Arc<RwLock<HashMap<String, Room>>>;

/// Global room registry.
static ROOMS: std::sync::OnceLock<Rooms> = std::sync::OnceLock::new();

fn rooms() -> &'static Rooms {
    ROOMS.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

/// Upgrade the HTTP request to a WebSocket for signaling.
pub async fn handle_signaling(
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, WebSocketError> {
    let (resp, fut) = upgrade::upgrade(&mut req.map(|b| {
        use http_body_util::BodyExt;
        b.boxed()
    }))?;

    tokio::task::spawn(async move {
        if let Err(e) = signaling_session(fut).await {
            eprintln!("signaling session error: {e}");
        }
    });

    Ok(resp.map(|_| Full::new(Bytes::new())))
}

/// Run a single signaling session for one peer.
async fn signaling_session(fut: upgrade::UpgradeFut) -> Result<(), WebSocketError> {
    let mut ws = fut.await?;
    ws.set_auto_pong(true);

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let mut current_room: Option<String> = None;
    let mut is_host = false;

    loop {
        tokio::select! {
            // Outgoing messages from room relay
            msg = rx.recv() => {
                match msg {
                    Some(text) => {
                        ws.write_frame(Frame::text(
                            fastwebsockets::Payload::Borrowed(text.as_bytes()),
                        )).await?;
                    }
                    None => break, // channel closed
                }
            }
            // Incoming messages from this peer
            frame = ws.read_frame() => {
                let frame = frame?;
                match frame.opcode {
                    OpCode::Close => break,
                    OpCode::Text => {
                        let text = std::str::from_utf8(&frame.payload)
                            .unwrap_or_default()
                            .to_owned();
                        handle_message(&text, &tx, &mut current_room, &mut is_host, &mut ws).await?;
                    }
                    _ => {} // ignore binary, ping/pong handled by auto_pong
                }
            }
        }
    }

    // Cleanup: leave room on disconnect
    if let Some(room_id) = current_room.take() {
        leave_room(&room_id, is_host).await;
    }

    Ok(())
}

/// Process a single text command from a peer.
async fn handle_message(
    text: &str,
    tx: &mpsc::UnboundedSender<String>,
    current_room: &mut Option<String>,
    is_host: &mut bool,
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
) -> Result<(), WebSocketError> {
    let (cmd, arg) = text.split_once(' ').unwrap_or((text, ""));

    match cmd {
        "LIST" => {
            let rooms_lock = rooms().read().await;
            // Build simple JSON array of room IDs
            let ids: Vec<String> = rooms_lock
                .iter()
                .filter(|(_, r)| r.client.is_none()) // only rooms waiting for a client
                .map(|(id, _)| format!("\"{}\"" , id))
                .collect();
            let json = format!("ROOMS [{}]", ids.join(","));
            ws.write_frame(Frame::text(
                fastwebsockets::Payload::Borrowed(json.as_bytes()),
            ))
            .await?;
        }

        "JOIN" => {
            if current_room.is_some() {
                send_error(ws, "already in a room, LEAVE first").await?;
                return Ok(());
            }

            let room_id = arg.trim().to_owned();
            if room_id.is_empty() {
                send_error(ws, "room ID required").await?;
                return Ok(());
            }

            let mut rooms_lock = rooms().write().await;

            if let Some(room) = rooms_lock.get_mut(&room_id) {
                // Room exists — join as client
                if room.client.is_some() {
                    send_error(ws, "room is full").await?;
                    return Ok(());
                }

                room.client = Some(Peer { tx: tx.clone() });
                *current_room = Some(room_id);
                *is_host = false;

                // Notify the new client of their role
                ws.write_frame(Frame::text(
                    fastwebsockets::Payload::Borrowed(b"JOINED client"),
                ))
                .await?;

                // Notify the host that a peer joined
                let _ = room.host.tx.send("PEER_JOINED".to_owned());
            } else {
                // Create new room — this peer is host
                rooms_lock.insert(
                    room_id.clone(),
                    Room {
                        host: Peer { tx: tx.clone() },
                        client: None,
                    },
                );
                *current_room = Some(room_id);
                *is_host = true;

                ws.write_frame(Frame::text(
                    fastwebsockets::Payload::Borrowed(b"JOINED host"),
                ))
                .await?;
            }
        }

        "LEAVE" => {
            if let Some(room_id) = current_room.take() {
                leave_room(&room_id, *is_host).await;
                ws.write_frame(Frame::text(
                    fastwebsockets::Payload::Borrowed(b"LEFT"),
                ))
                .await?;
            }
        }

        "SIGNAL" => {
            if let Some(room_id) = current_room.as_ref() {
                let payload = arg.to_owned();
                let rooms_lock = rooms().read().await;
                if let Some(room) = rooms_lock.get(room_id) {
                    let target_tx = if *is_host {
                        room.client.as_ref().map(|p| &p.tx)
                    } else {
                        Some(&room.host.tx)
                    };

                    if let Some(tx) = target_tx {
                        let _ = tx.send(format!("SIGNAL {payload}"));
                    } else {
                        send_error(ws, "no peer to signal").await?;
                    }
                }
            } else {
                send_error(ws, "not in a room").await?;
            }
        }

        _ => {
            send_error(ws, "unknown command").await?;
        }
    }

    Ok(())
}

/// Remove a peer from a room. Notify the remaining peer. Clean up empty rooms.
async fn leave_room(room_id: &str, is_host: bool) {
    let mut rooms_lock = rooms().write().await;

    let should_remove = if let Some(room) = rooms_lock.get_mut(room_id) {
        if is_host {
            // Host left: notify client, then remove room
            if let Some(client) = &room.client {
                let _ = client.tx.send("PEER_LEFT".to_owned());
            }
            true // always remove room when host leaves
        } else {
            // Client left: notify host, keep room open
            let _ = room.host.tx.send("PEER_LEFT".to_owned());
            room.client = None;
            false
        }
    } else {
        false
    };

    if should_remove {
        rooms_lock.remove(room_id);
    }
}

/// Send an ERROR frame to the peer.
async fn send_error(
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
    msg: &str,
) -> Result<(), WebSocketError> {
    let text = format!("ERROR {msg}");
    ws.write_frame(Frame::text(
        fastwebsockets::Payload::Borrowed(text.as_bytes()),
    ))
    .await
}
