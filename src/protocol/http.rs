use std::convert::Infallible;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::Incoming;
use hyper::{Method, Request, Response, StatusCode};

use crate::data;

type BoxBody = http_body_util::combinators::BoxBody<Bytes, Infallible>;

fn full(data: impl Into<Bytes>) -> BoxBody {
    Full::new(data.into()).boxed()
}

fn empty() -> BoxBody {
    Empty::new().boxed()
}

/// Parse a query string parameter by key.
/// Example: `parse_query_param("chunk_size=1024&foo=bar", "chunk_size")` → `Some("1024")`
fn parse_query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == key {
            Some(v)
        } else {
            None
        }
    })
}

/// Build the JSON string for `GET /info`, reporting enabled features.
pub fn build_info_response() -> String {
    let mut features: Vec<&str> = vec!["http"];

    if cfg!(feature = "ws") {
        features.push("ws");
    }
    if cfg!(feature = "webrtc") {
        features.push("webrtc");
    }

    // Manually build JSON to avoid serde dependency
    let features_json: Vec<String> = features.iter().map(|f| format!("\"{}\"", f)).collect();
    format!(
        "{{\"version\":\"0.1.0\",\"features\":[{}]}}",
        features_json.join(",")
    )
}

/// Handle HTTP speed-test routes.
pub async fn handle(
    req: Request<Incoming>,
    buffer: Arc<Vec<u8>>,
) -> Result<Response<BoxBody>, Infallible> {
    let mut resp = match (req.method(), req.uri().path()) {
        (&Method::GET, "/info") => {
            let info = build_info_response();
            let mut r = Response::new(full(info));
            r.headers_mut().insert(
                hyper::header::CONTENT_TYPE,
                "application/json".parse().unwrap(),
            );
            r
        }

        (&Method::GET, "/download") => {
            // Parse optional chunk_size from query string
            let chunk_size = req
                .uri()
                .query()
                .and_then(|q| parse_query_param(q, "chunk_size"))
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(data::DEFAULT_CHUNK_SIZE);

            // Clamp to reasonable range: 1 KB .. 16 MB
            let chunk_size = chunk_size.clamp(1024, 16 * 1024 * 1024);

            let stream = data::DownloadStream::new(buffer, chunk_size);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_query_param_works() {
        assert_eq!(
            parse_query_param("chunk_size=1024&foo=bar", "chunk_size"),
            Some("1024")
        );
        assert_eq!(
            parse_query_param("chunk_size=1024&foo=bar", "foo"),
            Some("bar")
        );
        assert_eq!(parse_query_param("chunk_size=1024", "missing"), None);
        assert_eq!(parse_query_param("", "chunk_size"), None);
    }

    #[test]
    fn info_response_contains_http() {
        let info = build_info_response();
        assert!(info.contains("\"http\""));
        assert!(info.contains("\"version\""));
    }
}
