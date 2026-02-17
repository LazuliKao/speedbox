//! WebRTC signaling server with lobby-based peer discovery and pairing.
//!
//! Activated by the `webrtc` Cargo feature.
//!
//! ## Protocol (text-based):
//!
//! ### Client → Server:
//! - `HELLO <json>`       → Announce presence: `{"name":"…","id":"…"}`
//! - `PAIR_REQUEST <id>`  → Send pairing request to target peer
//! - `PAIR_ACCEPT <id>`   → Accept pairing request from peer
//! - `PAIR_REJECT <id>`   → Reject pairing request from peer
//! - `UNPAIR`             → Disconnect from paired peer
//! - `SIGNAL <payload>`   → Forward SDP/ICE to paired peer
//! - `TEST_START <json>`  → Notify paired peer that test is starting
//! - `TEST_STOP`          → Notify paired peer that test stopped
//! - `TEST_UPDATE <json>` → Send speed/progress update to paired peer
//!
//! ### Server → Client:
//! - `HELLO_OK`                    → HELLO accepted
//! - `LOBBY <json>`                → Full lobby list: `[{"id":"…","name":"…","paired":bool},…]`
//! - `PEER_JOINED <json>`          → A peer entered the lobby
//! - `PEER_LEFT <id>`              → A peer left the lobby
//! - `PAIR_REQUEST <json>`         → Incoming pair request: `{"id":"…","name":"…"}`
//! - `PAIR_ACCEPTED <id>`          → Your pair request was accepted (unused, see PAIRED)
//! - `PAIR_REJECTED <id> <reason>` → Your pair request was rejected
//! - `PAIRED <id>`                 → Pairing established (sent to both)
//! - `UNPAIRED`                    → Pairing dissolved
//! - `SIGNAL <payload>`            → Forwarded SDP/ICE from paired peer
//! - `TEST_START <json>`           → Paired peer started a test
//! - `TEST_STOP`                   → Paired peer stopped the test
//! - `TEST_UPDATE <json>`          → Paired peer speed/progress update
//! - `ERROR <msg>`                 → Error message

use std::collections::HashMap;
use std::sync::Arc;

use bytes::Bytes;
use fastwebsockets::upgrade;
use fastwebsockets::{Frame, OpCode, WebSocketError};
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Request, Response};
use tokio::sync::{mpsc, RwLock};

// ── Data Structures ──────────────────────────────────────────────────

/// A connected peer in the lobby.
struct LobbyPeer {
    id: String,
    name: String,
    tx: mpsc::UnboundedSender<String>,
    /// ID of paired peer, if any.
    paired_with: Option<String>,
    /// ID of peer that sent us a pending pair request.
    pending_pair_from: Option<String>,
}

/// Global lobby: all connected peers indexed by their UUID.
type Lobby = Arc<RwLock<HashMap<String, LobbyPeer>>>;

static LOBBY: std::sync::OnceLock<Lobby> = std::sync::OnceLock::new();

fn lobby() -> &'static Lobby {
    LOBBY.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

// ── Entry Point ──────────────────────────────────────────────────────

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

// ── Session Loop ─────────────────────────────────────────────────────

/// Run a single signaling session for one peer.
async fn signaling_session(fut: upgrade::UpgradeFut) -> Result<(), WebSocketError> {
    let mut ws = fut.await?;
    ws.set_auto_pong(true);

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let mut my_id: Option<String> = None;

    loop {
        tokio::select! {
            // Outgoing messages relayed from lobby
            msg = rx.recv() => {
                match msg {
                    Some(text) => {
                        ws.write_frame(Frame::text(
                            fastwebsockets::Payload::Borrowed(text.as_bytes()),
                        )).await?;
                    }
                    None => break,
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
                        handle_message(&text, &tx, &mut my_id, &mut ws).await?;
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(id) = my_id.take() {
        peer_disconnect(&id).await;
    }

    Ok(())
}

// ── Message Handler ──────────────────────────────────────────────────

async fn handle_message(
    text: &str,
    tx: &mpsc::UnboundedSender<String>,
    my_id: &mut Option<String>,
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
) -> Result<(), WebSocketError> {
    let (cmd, arg) = text.split_once(' ').unwrap_or((text, ""));

    match cmd {
        "HELLO" => {
            let (id, name) = match parse_hello(arg) {
                Some(v) => v,
                None => {
                    send_error(ws, "invalid HELLO payload").await?;
                    return Ok(());
                }
            };

            let mut lob = lobby().write().await;

            if let Some(old_peer) = lob.remove(&id) {
                let _ = old_peer
                    .tx
                    .send("ERROR replaced by new connection".to_owned());
                if let Some(partner_id) = &old_peer.paired_with {
                    if let Some(partner) = lob.get_mut(partner_id) {
                        partner.paired_with = None;
                        partner.pending_pair_from = None;
                        let _ = partner.tx.send("UNPAIRED".to_owned());
                    }
                }
            }

            lob.insert(
                id.clone(),
                LobbyPeer {
                    id: id.clone(),
                    name: name.clone(),
                    tx: tx.clone(),
                    paired_with: None,
                    pending_pair_from: None,
                },
            );

            send(ws, "HELLO_OK").await?;

            let lobby_json = build_lobby_json(&lob, &id);
            send(ws, &format!("LOBBY {lobby_json}")).await?;

            let join_msg = format!(
                "PEER_JOINED {{\"id\":\"{id}\",\"name\":{},\"paired\":false}}",
                json_str(&name)
            );
            for (pid, peer) in lob.iter() {
                if pid != &id {
                    let _ = peer.tx.send(join_msg.clone());
                }
            }

            *my_id = Some(id);
        }

        "PAIR_REQUEST" => {
            let Some(sender_id) = my_id.as_ref() else {
                send_error(ws, "must HELLO first").await?;
                return Ok(());
            };

            let target_id = arg.trim();
            if target_id.is_empty() {
                send_error(ws, "target ID required").await?;
                return Ok(());
            }

            let mut lob = lobby().write().await;

            if let Some(sender) = lob.get(sender_id) {
                if sender.paired_with.is_some() {
                    send_error(ws, "already paired").await?;
                    return Ok(());
                }
            }

            let target_has_pending = match lob.get(target_id) {
                None => {
                    send_error(ws, "peer not found").await?;
                    return Ok(());
                }
                Some(t) => {
                    if t.paired_with.is_some() {
                        send(ws, &format!("PAIR_REJECTED {target_id} busy")).await?;
                        return Ok(());
                    }
                    t.pending_pair_from.is_some()
                }
            };

            if target_has_pending {
                send(ws, &format!("PAIR_REJECTED {target_id} busy")).await?;
                return Ok(());
            }

            let sender = lob.get(sender_id).unwrap();
            let sender_name = sender.name.clone();
            if let Some(pending) = &sender.pending_pair_from {
                if pending == target_id {
                    let sender = lob.get_mut(sender_id).unwrap();
                    sender.paired_with = Some(target_id.to_owned());
                    sender.pending_pair_from = None;
                    let target = lob.get_mut(target_id).unwrap();
                    target.paired_with = Some(sender_id.to_owned());
                    target.pending_pair_from = None;

                    let _ = lob
                        .get(sender_id)
                        .unwrap()
                        .tx
                        .send(format!("PAIRED {target_id}"));
                    let _ = lob
                        .get(target_id)
                        .unwrap()
                        .tx
                        .send(format!("PAIRED {sender_id}"));
                    return Ok(());
                }
            }

            let target = lob.get_mut(target_id).unwrap();
            target.pending_pair_from = Some(sender_id.to_owned());

            let req_msg = format!(
                "PAIR_REQUEST {{\"id\":\"{sender_id}\",\"name\":{}}}",
                json_str(&sender_name)
            );
            let _ = target.tx.send(req_msg);
        }

        "PAIR_ACCEPT" => {
            let Some(my) = my_id.as_ref() else {
                send_error(ws, "must HELLO first").await?;
                return Ok(());
            };

            let requester_id = arg.trim();
            let mut lob = lobby().write().await;

            let is_valid = lob
                .get(my)
                .and_then(|p| p.pending_pair_from.as_ref())
                .map(|pid| pid == requester_id)
                .unwrap_or(false);

            if !is_valid {
                send_error(ws, "no pending pair request from this peer").await?;
                return Ok(());
            }

            let requester_available = lob
                .get(requester_id)
                .map(|p| p.paired_with.is_none())
                .unwrap_or(false);

            if !requester_available {
                if let Some(me) = lob.get_mut(my) {
                    me.pending_pair_from = None;
                }
                send_error(ws, "requester no longer available").await?;
                return Ok(());
            }

            let me = lob.get_mut(my).unwrap();
            me.paired_with = Some(requester_id.to_owned());
            me.pending_pair_from = None;

            let requester = lob.get_mut(requester_id).unwrap();
            requester.paired_with = Some(my.to_owned());
            requester.pending_pair_from = None;

            let _ = lob
                .get(my)
                .unwrap()
                .tx
                .send(format!("PAIRED {requester_id}"));
            let _ = lob
                .get(requester_id)
                .unwrap()
                .tx
                .send(format!("PAIRED {my}"));
        }

        "PAIR_REJECT" => {
            let Some(my) = my_id.as_ref() else {
                send_error(ws, "must HELLO first").await?;
                return Ok(());
            };

            let requester_id = arg.trim();
            let mut lob = lobby().write().await;

            if let Some(me) = lob.get_mut(my) {
                if me.pending_pair_from.as_deref() == Some(requester_id) {
                    me.pending_pair_from = None;
                }
            }

            if let Some(requester) = lob.get(requester_id) {
                let _ = requester.tx.send(format!("PAIR_REJECTED {my} declined"));
            }
        }

        "UNPAIR" => {
            let Some(my) = my_id.as_ref() else {
                send_error(ws, "must HELLO first").await?;
                return Ok(());
            };

            let mut lob = lobby().write().await;
            unpair_peer(&mut lob, my);
        }

        "SIGNAL" => {
            let Some(my) = my_id.as_ref() else {
                send_error(ws, "must HELLO first").await?;
                return Ok(());
            };

            let payload = arg.to_owned();
            let lob = lobby().read().await;

            if let Some(me) = lob.get(my) {
                if let Some(partner_id) = &me.paired_with {
                    if let Some(partner) = lob.get(partner_id) {
                        let _ = partner.tx.send(format!("SIGNAL {payload}"));
                    }
                } else {
                    drop(lob);
                    send_error(ws, "not paired").await?;
                }
            }
        }

        "TEST_START" => {
            relay_to_partner(my_id, &format!("TEST_START {arg}")).await;
        }

        "TEST_STOP" => {
            relay_to_partner(my_id, "TEST_STOP").await;
        }

        "TEST_UPDATE" => {
            relay_to_partner(my_id, &format!("TEST_UPDATE {arg}")).await;
        }

        _ => {
            send_error(ws, "unknown command").await?;
        }
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Relay a message to the paired partner (if any).
async fn relay_to_partner(my_id: &Option<String>, msg: &str) {
    let Some(my) = my_id.as_ref() else { return };
    let lob = lobby().read().await;
    if let Some(me) = lob.get(my) {
        if let Some(partner_id) = &me.paired_with {
            if let Some(partner) = lob.get(partner_id) {
                let _ = partner.tx.send(msg.to_owned());
            }
        }
    }
}

/// Handle peer disconnect: unpair, remove from lobby, notify others.
async fn peer_disconnect(id: &str) {
    let mut lob = lobby().write().await;

    unpair_peer(&mut lob, id);

    for (_, peer) in lob.iter_mut() {
        if peer.pending_pair_from.as_deref() == Some(id) {
            peer.pending_pair_from = None;
        }
    }

    lob.remove(id);

    let leave_msg = format!("PEER_LEFT {id}");
    for (_, peer) in lob.iter() {
        let _ = peer.tx.send(leave_msg.clone());
    }
}

/// Unpair a peer and its partner. Notifies both.
fn unpair_peer(lob: &mut HashMap<String, LobbyPeer>, id: &str) {
    let partner_id = lob.get(id).and_then(|p| p.paired_with.clone());

    if let Some(partner_id) = partner_id {
        if let Some(partner) = lob.get_mut(&partner_id) {
            partner.paired_with = None;
            let _ = partner.tx.send("UNPAIRED".to_owned());
        }
        if let Some(me) = lob.get_mut(id) {
            me.paired_with = None;
            let _ = me.tx.send("UNPAIRED".to_owned());
        }
    }
}

/// Build lobby JSON array (excluding the given peer).
fn build_lobby_json(lob: &HashMap<String, LobbyPeer>, exclude_id: &str) -> String {
    let entries: Vec<String> = lob
        .iter()
        .filter(|(pid, _)| *pid != exclude_id)
        .map(|(_, p)| {
            format!(
                "{{\"id\":\"{}\",\"name\":{},\"paired\":{}}}",
                p.id,
                json_str(&p.name),
                p.paired_with.is_some()
            )
        })
        .collect();
    format!("[{}]", entries.join(","))
}

/// Escape a string as a JSON string value (with quotes).
fn json_str(s: &str) -> String {
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
}

/// Minimal JSON parser for HELLO payload: extracts "id" and "name" fields.
fn parse_hello(json: &str) -> Option<(String, String)> {
    let id = extract_json_string(json, "id")?;
    let name = extract_json_string(json, "name")?;
    if id.is_empty() {
        return None;
    }
    Some((id, name))
}

/// Extract a simple string value from a JSON-like string: `"key":"value"`.
fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let start = json.find(&pattern)?;
    let after_key = &json[start + pattern.len()..];
    let after_colon = after_key.trim_start().strip_prefix(':')?;
    let after_colon = after_colon.trim_start();
    let after_quote = after_colon.strip_prefix('"')?;
    let mut result = String::new();
    let mut chars = after_quote.chars();
    loop {
        match chars.next()? {
            '\\' => match chars.next()? {
                '"' => result.push('"'),
                '\\' => result.push('\\'),
                'n' => result.push('\n'),
                'r' => result.push('\r'),
                't' => result.push('\t'),
                c => {
                    result.push('\\');
                    result.push(c);
                }
            },
            '"' => break,
            c => result.push(c),
        }
    }
    Some(result)
}

/// Send a text frame to the peer.
async fn send(
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
    msg: &str,
) -> Result<(), WebSocketError> {
    ws.write_frame(Frame::text(
        fastwebsockets::Payload::Borrowed(msg.as_bytes()),
    ))
    .await
}

/// Send an ERROR frame to the peer.
async fn send_error(
    ws: &mut fastwebsockets::WebSocket<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>,
    msg: &str,
) -> Result<(), WebSocketError> {
    send(ws, &format!("ERROR {msg}")).await
}
