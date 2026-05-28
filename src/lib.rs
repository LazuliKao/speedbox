pub mod config;
pub mod data;
pub mod protocol;

use std::convert::Infallible;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::combinators::BoxBody;
#[cfg(any(feature = "ws", feature = "webrtc"))]
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::Request;
use hyper::Response;
#[cfg(any(feature = "ws", feature = "webrtc"))]
use hyper::StatusCode;

/// Route a request to the appropriate protocol handler.
pub async fn route(
    req: Request<Incoming>,
    buffer: Arc<Vec<u8>>,
) -> Result<Response<BoxBody<Bytes, Infallible>>, Infallible> {
    #[allow(unused_variables)]
    let path = req.uri().path().to_owned();

    #[cfg(feature = "ws")]
    if path == "/ws/speed" {
        return match protocol::ws::handle_ws_speed(req, buffer).await {
            Ok(resp) => Ok(resp.map(|b| b.boxed())),
            Err(e) => {
                eprintln!("ws upgrade error: {e}");
                let mut r = Response::new(Full::new(Bytes::from("ws upgrade failed")).boxed());
                *r.status_mut() = StatusCode::BAD_REQUEST;
                Ok(r)
            }
        };
    }

    #[cfg(feature = "webrtc")]
    if path == "/ws/signal" {
        return match protocol::signaling::handle_signaling(req).await {
            Ok(resp) => Ok(resp.map(|b| b.boxed())),
            Err(e) => {
                eprintln!("signaling upgrade error: {e}");
                let mut r =
                    Response::new(Full::new(Bytes::from("signaling upgrade failed")).boxed());
                *r.status_mut() = StatusCode::BAD_REQUEST;
                Ok(r)
            }
        };
    }

    protocol::http::handle(req, buffer).await
}
