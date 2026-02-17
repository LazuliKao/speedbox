use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::combinators::BoxBody;
#[cfg(any(feature = "ws", feature = "webrtc"))]
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::Request;
#[cfg(any(feature = "ws", feature = "webrtc"))]
use hyper::StatusCode;
use hyper::Response;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

mod config;
mod data;
mod protocol;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::load();
    let addr: SocketAddr = format!("{}:{}", config.bind_addr, config.port).parse()?;
    let buffer = Arc::new(data::generate_buffer());

    let listener = TcpListener::bind(addr).await?;
    eprintln!("speedbox listening on {}", addr);

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let buffer = buffer.clone();

        tokio::task::spawn(async move {
            let service = service_fn(move |req| {
                let buffer = buffer.clone();
                route(req, buffer)
            });

            let conn = http1::Builder::new().serve_connection(io, service);

            #[cfg(feature = "ws")]
            let conn = conn.with_upgrades();

            if let Err(e) = conn.await {
                eprintln!("connection error: {e}");
            }
        });
    }
}

async fn route(
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
