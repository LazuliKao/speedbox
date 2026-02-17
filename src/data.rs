use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use http_body::Frame;

const BUFFER_SIZE: usize = 4 * 1024 * 1024; // 4 MB

/// Default chunk size for download streams (64 KB).
pub const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;

/// Generate a 4 MB buffer of pseudo-random bytes using xorshift64.
/// The random content defeats any transparent compression on the wire.
pub fn generate_buffer() -> Vec<u8> {
    let mut buf = vec![0u8; BUFFER_SIZE];
    let mut state: u64 = 0xdead_beef_cafe_1234;
    for chunk in buf.chunks_mut(8) {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let bytes = state.to_le_bytes();
        let len = chunk.len().min(8);
        chunk[..len].copy_from_slice(&bytes[..len]);
    }
    buf
}

/// Infinite stream that yields chunks from the circular buffer.
/// The client decides when to stop (AbortController / connection close).
pub struct DownloadStream {
    buffer: Arc<Vec<u8>>,
    offset: usize,
    chunk_size: usize,
}

impl DownloadStream {
    pub fn new(buffer: Arc<Vec<u8>>, chunk_size: usize) -> Self {
        Self {
            buffer,
            offset: 0,
            chunk_size,
        }
    }
}

impl futures_core::Stream for DownloadStream {
    type Item = Result<Frame<Bytes>, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let buf_len = self.buffer.len();
        let start = self.offset;
        let end = (start + self.chunk_size).min(buf_len);
        let chunk = Bytes::copy_from_slice(&self.buffer[start..end]);
        self.offset = if end >= buf_len { 0 } else { end };
        Poll::Ready(Some(Ok(Frame::data(chunk))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_core::Stream;

    #[test]
    fn buffer_is_populated_and_random() {
        let buf = generate_buffer();
        assert_eq!(buf.len(), BUFFER_SIZE);
        // Not all zeros
        assert!(buf.iter().any(|&b| b != 0));
        // Has variance (not a single repeated byte)
        assert!(buf.windows(2).any(|w| w[0] != w[1]));
    }

    #[test]
    fn buffer_size_correct() {
        let buf = generate_buffer();
        assert_eq!(buf.len(), 4 * 1024 * 1024);
    }

    #[test]
    fn stream_yields_chunks() {
        let buf = Arc::new(generate_buffer());
        let mut stream = DownloadStream::new(buf, DEFAULT_CHUNK_SIZE);

        use std::task::{RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(p: *const ()) -> RawWaker {
            RawWaker::new(p, &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);

        let pin = Pin::new(&mut stream);
        match pin.poll_next(&mut cx) {
            Poll::Ready(Some(Ok(frame))) => {
                let data: Bytes = frame.into_data().unwrap();
                assert_eq!(data.len(), DEFAULT_CHUNK_SIZE);
            }
            other => panic!("expected data frame, got {:?}", other),
        }
    }

    #[test]
    fn stream_wraps_around() {
        let buf = Arc::new(generate_buffer());
        let mut stream = DownloadStream::new(buf, DEFAULT_CHUNK_SIZE);

        use std::task::{RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(p: *const ()) -> RawWaker {
            RawWaker::new(p, &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);

        // Drain enough chunks to wrap around the 4 MB buffer
        let chunks_to_wrap = (BUFFER_SIZE / DEFAULT_CHUNK_SIZE) + 1;
        for _ in 0..chunks_to_wrap {
            let pin = Pin::new(&mut stream);
            assert!(matches!(pin.poll_next(&mut cx), Poll::Ready(Some(Ok(_)))));
        }
        // After wrapping, offset should be back near the start
        assert!(stream.offset < DEFAULT_CHUNK_SIZE * 2);
    }
}
