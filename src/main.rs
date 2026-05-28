use std::net::SocketAddr;
use std::sync::Arc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use speedbox::config;
use speedbox::data;
use speedbox::route;

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
