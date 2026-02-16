use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

mod config;
mod data;

type BoxBody = http_body_util::combinators::BoxBody<Bytes, Infallible>;

fn full(data: impl Into<Bytes>) -> BoxBody {
    Full::new(data.into()).boxed()
}

fn empty() -> BoxBody {
    Empty::new().boxed()
}

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
                handle(req, buffer)
            });
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service)
                .await
            {
                eprintln!("connection error: {e}");
            }
        });
    }
}

async fn handle(
    req: Request<Incoming>,
    buffer: Arc<Vec<u8>>,
) -> Result<Response<BoxBody>, Infallible> {
    let mut resp = match (req.method(), req.uri().path()) {
        (&Method::GET, "/info") => Response::new(full("speedbox 0.1.0")),

        (&Method::GET, "/download") => {
            let stream = data::DownloadStream::new(buffer);
            let body = StreamBody::new(stream).boxed();
            let mut r = Response::new(body);
            r.headers_mut().insert(
                hyper::header::CONTENT_TYPE,
                "application/octet-stream".parse().unwrap(),
            );
            r.headers_mut()
                .insert("cache-control", "no-store".parse().unwrap());
            r
        }

        (&Method::POST, "/upload") => {
            let mut body = req.into_body();
            let mut total: u64 = 0;
            while let Some(frame) = body.frame().await {
                match frame {
                    Ok(f) => {
                        if let Some(chunk) = f.data_ref() {
                            total += chunk.len() as u64;
                        }
                    }
                    Err(_) => break,
                }
            }
            Response::new(full(format!("received={total}")))
        }

        (&Method::OPTIONS, _) => Response::new(empty()),

        _ => {
            let mut r = Response::new(full("not found"));
            *r.status_mut() = StatusCode::NOT_FOUND;
            r
        }
    };

    // CORS headers on every response
    let h = resp.headers_mut();
    h.insert("access-control-allow-origin", "*".parse().unwrap());
    h.insert(
        "access-control-allow-methods",
        "GET, POST, OPTIONS".parse().unwrap(),
    );
    h.insert(
        "access-control-allow-headers",
        "content-type".parse().unwrap(),
    );

    Ok(resp)
}
