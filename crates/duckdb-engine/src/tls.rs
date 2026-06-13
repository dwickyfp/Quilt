//! Shared TLS trust configuration for Quilt's HTTP clients.
//!
//! ureq (REST / cloud-API connectors) and reqwest (the desktop engine
//! downloads) both default to the bundled Mozilla root set (webpki-roots),
//! which ignores the operating-system trust store. Behind a TLS-inspecting
//! corporate proxy (Zscaler, Netskope, ...) that re-signs every certificate
//! with its own CA, that CA lives only in the OS store, so the handshake
//! fails with `UnknownIssuer`.
//!
//! We build ONE rustls client config whose root store is the union of:
//!   1. the bundled Mozilla roots (identical to the previous default), plus
//!   2. the OS native trust store (adds the corporate inspection CA), plus
//!   3. an optional explicit PEM bundle pointed at by `QUILT_CA_CERT`.
//!
//! It is a strict superset of the old trust set, so non-corporate users see
//! no behavioural change: everything that validated before still validates.
//! The OS store and env bundle are best-effort - a missing or unreadable
//! source just leaves the bundled roots in place.

use std::sync::{Arc, OnceLock};

/// Assemble the union root store: bundled Mozilla roots, the OS native store,
/// and an optional `QUILT_CA_CERT` PEM bundle.
fn build_root_store() -> rustls::RootCertStore {
    let mut roots = rustls::RootCertStore::empty();

    // 1. Bundled Mozilla roots - the prior default on every platform, so no
    //    machine loses trust it had before.
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    // 2. OS trust store - adds enterprise / proxy-inspection CAs. Best effort.
    match rustls_native_certs::load_native_certs() {
        Ok(certs) => {
            let _ = roots.add_parsable_certificates(certs);
        }
        Err(e) => {
            eprintln!("quilt: could not read OS certificate store: {e}");
        }
    }

    // 3. Optional explicit PEM bundle, for split-tunnel setups or where the
    //    proxy CA is handed out as a file rather than installed in the store.
    if let Ok(path) = std::env::var("QUILT_CA_CERT") {
        if !path.is_empty() {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let mut rd = std::io::BufReader::new(&bytes[..]);
                    let extra: Vec<_> = rustls_pemfile::certs(&mut rd)
                        .filter_map(Result::ok)
                        .collect();
                    let _ = roots.add_parsable_certificates(extra);
                }
                Err(e) => eprintln!("quilt: QUILT_CA_CERT unreadable ({path}): {e}"),
            }
        }
    }

    roots
}

/// Build a fresh rustls client config trusting bundled + OS-native (+ optional
/// `QUILT_CA_CERT`) roots. reqwest consumes this via `use_preconfigured_tls`.
pub fn build_client_config() -> rustls::ClientConfig {
    // Match ureq's provider (ring) so we add no second crypto backend and
    // avoid depending on a process-wide default provider being installed.
    rustls::ClientConfig::builder_with_provider(rustls::crypto::ring::default_provider().into())
        .with_safe_default_protocol_versions()
        .expect("ring provider supports TLS 1.2 + 1.3")
        .with_root_certificates(build_root_store())
        .with_no_client_auth()
}

/// A process-wide ureq agent using the merged trust config above. The agent
/// is internally reference-counted, so cloning it per request is cheap; we
/// build it once and hand out clones.
pub fn http_agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT
        .get_or_init(|| {
            ureq::AgentBuilder::new()
                .tls_config(Arc::new(build_client_config()))
                .build()
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merged_store_is_a_superset_of_bundled_roots() {
        // The merged store must contain at least every bundled Mozilla root,
        // so non-corporate users never lose trust they had before.
        let bundled = webpki_roots::TLS_SERVER_ROOTS.len();
        let merged = build_root_store().roots.len();
        assert!(
            merged >= bundled,
            "merged roots ({merged}) dropped below bundled roots ({bundled})"
        );
    }

    #[test]
    fn agent_builds() {
        let _ = http_agent();
    }
}
