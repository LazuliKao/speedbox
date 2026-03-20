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
        let bind_addr = std::env::var("SPEEDBOX_BIND").unwrap_or_else(|_| "0.0.0.0".to_string());
        Self { port, bind_addr }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        std::env::remove_var("SPEEDBOX_PORT");
        std::env::remove_var("SPEEDBOX_BIND");
        let cfg = Config::load();
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.bind_addr, "0.0.0.0");
    }

    #[test]
    fn env_override() {
        std::env::set_var("SPEEDBOX_PORT", "9090");
        std::env::set_var("SPEEDBOX_BIND", "127.0.0.1");
        let cfg = Config::load();
        assert_eq!(cfg.port, 9090);
        assert_eq!(cfg.bind_addr, "127.0.0.1");
        std::env::remove_var("SPEEDBOX_PORT");
        std::env::remove_var("SPEEDBOX_BIND");
    }
}
