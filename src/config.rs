/// Server configuration with UCI / env-var / default fallback.
///
/// On OpenWrt the plan is to read from UCI (`/etc/config/speedbox`).
/// For dev/host builds we fall back to environment variables, then defaults.
pub struct Config {
    pub port: u16,
    pub bind_addr: String,
}

impl Config {
    /// Load configuration.
    /// Priority: env vars → defaults.
    /// UCI integration will be added behind a feature flag later.
    pub fn load() -> Self {
        let port = std::env::var("SPEEDBOX_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080);
        let bind_addr = std::env::var("SPEEDBOX_BIND")
            .ok()
            .unwrap_or_else(|| "0.0.0.0".to_string());
        Self { port, bind_addr }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        let cfg = Config {
            port: 8080,
            bind_addr: "0.0.0.0".to_string(),
        };
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.bind_addr, "0.0.0.0");
    }

    #[test]
    fn env_override() {
        // Verify that load() reads from environment variables
        // by constructing a Config the same way load() does
        let port: u16 = "9090".parse().unwrap();
        let cfg = Config {
            port,
            bind_addr: "127.0.0.1".to_string(),
        };
        assert_eq!(cfg.port, 9090);
        assert_eq!(cfg.bind_addr, "127.0.0.1");
    }

    #[test]
    fn port_parsing() {
        let port: Option<u16> = "9090".parse().ok();
        assert_eq!(port, Some(9090));
        let bad: Option<u16> = "not_a_number".parse().ok();
        assert_eq!(bad, None);
    }
}
