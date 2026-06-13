//! Engine installation manager.
//!
//! Quilt ships a tiny shell and downloads its execution engine on
//! first launch into the app-data directory, rather than statically
//! bundling it: fetch the platform's release zip from GitHub, extract
//! the binary, mark it executable, and verify it runs.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const DUCKDB_VERSION: &str = "1.5.3";
/// Pinned llama.cpp build. Bump periodically; the GGUF wire format
/// is stable so newer server binaries keep working with older models.
/// Note: assets at older builds use a different naming (avx/avx2/cuda
/// flavors) - keep this on a recent build that ships the `*-cpu-*`
/// universal variant.
pub const LLAMACPP_BUILD: &str = "b9305";
/// HuggingFace model artifact for the AI chat assistant. Qwen2.5
/// Coder 1.5B Instruct Q4_K_M - ~1.1 GB, runs on CPU on typical
/// laptops, tuned for code / structured-JSON generation.
pub const LLAMA_MODEL_REPO: &str = "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF";
pub const LLAMA_MODEL_FILE: &str = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";

/// Static description of an installable engine.
struct EngineSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    required: bool,
    repo: &'static str,
    version: &'static str,
    /// Binary base name (without the .exe suffix).
    binary: &'static str,
}

const DUCKDB: EngineSpec = EngineSpec {
    id: "duckdb",
    name: "DuckDB",
    description: "Default engine - local analytics, file formats, SQL.",
    required: true,
    repo: "duckdb/duckdb",
    version: DUCKDB_VERSION,
    binary: "duckdb",
};

/// llama.cpp HTTP server + a small Qwen GGUF model. Treated as an
/// optional "engine" for UX consistency with the setup screen but
/// powers the Duckie AI Assistant chat panel rather than the SQL
/// execution path.
const LLAMACPP: EngineSpec = EngineSpec {
    id: "llamacpp",
    name: "Duckie AI Assistant",
    description: "Local chat assistant via llama.cpp + Qwen 1.5B. Downloads ~1.1 GB; runs entirely offline once installed.",
    required: false,
    // Repo moved from ggerganov to ggml-org in mid-2025; use the new
    // org path directly to skip the 301 redirect.
    repo: "ggml-org/llama.cpp",
    version: LLAMACPP_BUILD,
    binary: "llama-server",
};

const ENGINES: [&EngineSpec; 2] = [&DUCKDB, &LLAMACPP];

fn spec(id: &str) -> Option<&'static EngineSpec> {
    ENGINES.iter().copied().find(|e| e.id == id)
}

fn binary_file_name(s: &EngineSpec) -> String {
    if cfg!(windows) {
        format!("{}.exe", s.binary)
    } else {
        s.binary.to_string()
    }
}

fn engine_dir(app_data: &Path, s: &EngineSpec) -> PathBuf {
    app_data.join("engines").join(s.id)
}

fn binary_path(app_data: &Path, s: &EngineSpec) -> PathBuf {
    engine_dir(app_data, s).join(binary_file_name(s))
}

/// Public helper kept for the engine() resolver in lib.rs.
pub fn duckdb_path(app_data: &Path) -> PathBuf {
    binary_path(app_data, &DUCKDB)
}

/// Path the AI assistant server binary lands at.
pub fn llamacpp_path(app_data: &Path) -> PathBuf {
    binary_path(app_data, &LLAMACPP)
}

/// Path the Qwen GGUF model file lands at (sibling of the binary).
pub fn llama_model_path(app_data: &Path) -> PathBuf {
    engine_dir(app_data, &LLAMACPP).join(LLAMA_MODEL_FILE)
}

/// Release asset name for this OS/arch, or None if unsupported.
fn asset_for(s: &EngineSpec) -> Option<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match s.id {
        "duckdb" => Some(
            match (os, arch) {
                ("windows", "x86_64") => "duckdb_cli-windows-amd64.zip",
                ("windows", "aarch64") => "duckdb_cli-windows-arm64.zip",
                ("linux", "x86_64") => "duckdb_cli-linux-amd64.zip",
                ("linux", "aarch64") => "duckdb_cli-linux-aarch64.zip",
                ("macos", _) => "duckdb_cli-osx-universal.zip",
                _ => return None,
            }
            .to_string(),
        ),
        // llama.cpp ships pre-built binaries per OS/arch. We pick the
        // most-compatible variant (no GPU acceleration) so the model
        // runs on any CPU - the chat assistant only needs ~5 tok/s.
        // Windows ships as zip; Linux + macOS as tar.gz.
        "llamacpp" => Some(
            match (os, arch) {
                ("windows", "x86_64") => format!("llama-{}-bin-win-cpu-x64.zip", LLAMACPP_BUILD),
                ("windows", "aarch64") => format!("llama-{}-bin-win-cpu-arm64.zip", LLAMACPP_BUILD),
                ("linux", "x86_64") => format!("llama-{}-bin-ubuntu-x64.tar.gz", LLAMACPP_BUILD),
                ("linux", "aarch64") => format!("llama-{}-bin-ubuntu-arm64.tar.gz", LLAMACPP_BUILD),
                ("macos", "aarch64") => format!("llama-{}-bin-macos-arm64.tar.gz", LLAMACPP_BUILD),
                ("macos", _) => format!("llama-{}-bin-macos-x64.tar.gz", LLAMACPP_BUILD),
                _ => return None,
            },
        ),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
pub struct EngineStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub required: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InstallProgress {
    Downloading { received: u64, total: Option<u64> },
    Extracting,
    Verifying,
    /// Per-extension progress for the DuckDB extension pre-install step
    /// that runs after the engine binary lands. Fetching them up front
    /// means the first time a fresh user touches a Postgres source or an
    /// S3 file there is no network hop.
    InstallingExtension { name: String, index: u32, total: u32 },
    /// Model-file download phase, used only by the llamacpp engine.
    /// The model is much larger than the binary (~1.1 GB vs ~50 MB)
    /// so we report its progress separately for clearer UX.
    DownloadingModel { received: u64, total: Option<u64> },
    Done { path: String },
}

/// DuckDB extensions Quilt uses or is wired to use. Pre-installed once
/// at first launch so future ATTACH / read_xlsx / httpfs calls do not
/// stop to download an extension mid-run.
const DUCKDB_EXTENSIONS: &[&str] = &[
    "httpfs",   // S3 / GCS / HTTP(S) URLs
    "azure",    // Azure Blob native
    "sqlite",   // SQLite ATTACH
    "postgres", // PostgreSQL ATTACH
    "mysql",    // MySQL / MariaDB ATTACH
    "excel",    // .xlsx reader
    "iceberg",  // Apache Iceberg table scan + write (v1.5+)
    "delta",    // Delta Lake table scan
    "ducklake", // DuckLake: DuckDB-native lakehouse catalog
    "vss",      // Vector similarity search (array_* distance funcs)
    "fts",      // Full-text search (BM25 keyword scoring)
    // The avro community extension hasn't published for v1.4+ yet; src.avro
    // is marked preview in the palette until it catches up.
];

fn duckdb_command(bin: &Path) -> std::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = std::process::Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: suppress the console flash on Windows.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Walk through every DuckDB extension Quilt needs, INSTALL+LOADing each
/// so the file lands in the user's local DuckDB extension cache. Failures
/// are logged via the progress callback but never abort the engine
/// install: a user offline for one extension still gets a working engine
/// and the rest of the extensions; the missing one will autoload (or
/// fail loudly) the first time it's actually used.
fn install_duckdb_extensions<F: FnMut(InstallProgress)>(bin: &Path, on_progress: &mut F) {
    let total = DUCKDB_EXTENSIONS.len() as u32;
    for (i, ext) in DUCKDB_EXTENSIONS.iter().enumerate() {
        on_progress(InstallProgress::InstallingExtension {
            name: (*ext).to_string(),
            index: (i as u32) + 1,
            total,
        });
        let sql = format!("INSTALL {ext}; LOAD {ext};");
        // Best-effort: ignore the result; the next step (or a later run)
        // will retry. Don't let one slow / unreachable extension block
        // the whole engine install.
        let _ = duckdb_command(bin)
            .arg(":memory:")
            .arg("-c")
            .arg(&sql)
            .output();
    }
}

pub fn status(app_data: &Path) -> Vec<EngineStatus> {
    ENGINES
        .iter()
        .map(|s| {
            let path = binary_path(app_data, s);
            let installed = path.exists();
            EngineStatus {
                id: s.id.to_string(),
                name: s.name.to_string(),
                description: s.description.to_string(),
                required: s.required,
                installed,
                version: installed.then(|| s.version.to_string()),
                path: installed.then(|| path.to_string_lossy().to_string()),
                available: asset_for(s).is_some(),
            }
        })
        .collect()
}

/// Download + install any engine by id. Streams progress.
pub fn install<F: FnMut(InstallProgress)>(
    app_data: &Path,
    engine_id: &str,
    on_progress: F,
) -> Result<String, String> {
    let s = spec(engine_id).ok_or_else(|| format!("Unknown engine '{}'", engine_id))?;
    install_spec(app_data, s, on_progress)
}

fn install_spec<F: FnMut(InstallProgress)>(
    app_data: &Path,
    s: &EngineSpec,
    mut on_progress: F,
) -> Result<String, String> {
    let asset = asset_for(s).ok_or_else(|| {
        format!(
            "No {} build for {}-{}",
            s.name,
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    // Tag naming convention varies per upstream: DuckDB uses
    // v-prefixed semver tags (v1.5.3); llama.cpp uses raw build tags
    // (b9305). Pre-prepending `v` to every version produces a 404
    // against ggml-org/llama.cpp.
    let tag = if s.id == "llamacpp" {
        s.version.to_string()
    } else {
        format!("v{}", s.version)
    };
    let url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        s.repo, tag, asset
    );

    let dir = engine_dir(app_data, s);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .user_agent("quilt")
        // Trust the OS store (+ optional QUILT_CA_CERT) on top of the bundled
        // roots so the engine download works behind a TLS-inspecting proxy.
        .use_preconfigured_tls(quilt_duckdb_engine::tls::build_client_config())
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "Couldn't download {} (HTTP {}). The release {} may not exist yet.",
            s.name,
            resp.status().as_u16(),
            s.version
        ));
    }
    let total = resp.content_length();
    let mut buf: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut chunk = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    on_progress(InstallProgress::Downloading { received: 0, total });
    loop {
        let n = resp.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        received += n as u64;
        on_progress(InstallProgress::Downloading { received, total });
    }

    let target = binary_path(app_data, s);

    let lower = asset.to_ascii_lowercase();
    if lower.ends_with(".zip") {
        on_progress(InstallProgress::Extracting);
        let want = binary_file_name(s);
        let reader = std::io::Cursor::new(buf);
        let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
        let mut extracted = false;
        // llama.cpp's zip ships the server binary alongside several
        // shared libraries (llama.dll, ggml.dll, ...) that the binary
        // dlopens at runtime - we have to extract them too. DuckDB
        // ships a single self-contained binary; the targeted extract
        // path stays for it.
        let extract_all = s.id == "llamacpp";
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            let leaf = name.rsplit('/').next().unwrap_or(&name).to_string();
            if file.is_dir() || leaf.is_empty() {
                continue;
            }
            let is_target_binary =
                leaf.eq_ignore_ascii_case(&want) || leaf.eq_ignore_ascii_case(s.binary);
            if extract_all {
                let out_path = dir.join(&leaf);
                let mut out =
                    std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
                if is_target_binary {
                    extracted = true;
                }
                #[cfg(unix)]
                if is_target_binary {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &out_path,
                        std::fs::Permissions::from_mode(0o755),
                    );
                }
            } else if is_target_binary {
                let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
                extracted = true;
                break;
            }
        }
        if !extracted {
            return Err(format!(
                "{} binary not found inside the downloaded archive",
                s.name
            ));
        }
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        // llama.cpp's Linux + macOS releases ship as tar.gz. Same
        // semantics as the llamacpp zip branch: extract every file
        // to the engine dir so the binary keeps its sibling .so / .dylib.
        on_progress(InstallProgress::Extracting);
        let want = binary_file_name(s);
        let gz = flate2::read::GzDecoder::new(std::io::Cursor::new(buf));
        let mut archive = tar::Archive::new(gz);
        let mut extracted = false;
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
            let leaf = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if entry.header().entry_type().is_dir() || leaf.is_empty() {
                continue;
            }
            let is_target_binary =
                leaf.eq_ignore_ascii_case(&want) || leaf.eq_ignore_ascii_case(s.binary);
            let out_path = dir.join(&leaf);
            let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            if is_target_binary {
                extracted = true;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &out_path,
                    std::fs::Permissions::from_mode(0o755),
                );
            }
        }
        if !extracted {
            return Err(format!(
                "{} binary not found inside the downloaded tarball",
                s.name
            ));
        }
    } else {
        // Every engine asset is a .zip (duckdb, llamacpp/win) or
        // .tar.gz (llamacpp/unix). An unrecognized format means a new
        // engine was added without a matching extract path - fail loudly
        // rather than write a misnamed blob to the binary path.
        return Err(format!(
            "{} asset '{}' has an unsupported format (expected .zip or .tar.gz)",
            s.name, asset
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    // Verify the binary landed and is non-empty. Probing --version is
    // best-effort: DuckDB supports it; we don't assume every engine does,
    // so a non-zero --version isn't fatal as long as the file is there.
    on_progress(InstallProgress::Verifying);
    let bytes = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    if bytes == 0 {
        return Err(format!("Installed {} binary is empty", s.name));
    }
    let _ = duckdb_command(&target).arg("--version").output();

    // Pre-fetch the extensions Quilt uses so the first connector hit
    // doesn't pause to download an extension. Only meaningful for the
    // DuckDB engine.
    if s.id == "duckdb" {
        install_duckdb_extensions(&target, &mut on_progress);
    }

    // llama.cpp's binary alone is useless without a model. Fetch the
    // pinned Qwen GGUF from HuggingFace right after the binary lands.
    if s.id == "llamacpp" {
        install_llama_model(app_data, &mut on_progress)?;
    }

    let path = target.to_string_lossy().to_string();
    on_progress(InstallProgress::Done { path: path.clone() });
    Ok(path)
}

/// Download the Qwen GGUF model file into the llamacpp engine dir.
/// Separate phase from the binary download so the UI can show "stage
/// 2 of 2" instead of one big progress bar for both. HuggingFace
/// supports range requests; we just stream sequentially for simplicity.
fn install_llama_model<F: FnMut(InstallProgress)>(
    app_data: &Path,
    on_progress: &mut F,
) -> Result<(), String> {
    let target = llama_model_path(app_data);
    // Idempotent: if the model file is already there and non-empty,
    // skip the download.
    if let Ok(meta) = std::fs::metadata(&target) {
        if meta.len() > 1_000_000 {
            return Ok(());
        }
    }
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        LLAMA_MODEL_REPO, LLAMA_MODEL_FILE
    );
    let client = reqwest::blocking::Client::builder()
        .user_agent("quilt")
        // No global timeout - the model is over a GB on home internet.
        .timeout(None)
        // Same merged trust store as the engine download (OS + bundled roots).
        .use_preconfigured_tls(quilt_duckdb_engine::tls::build_client_config())
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "Couldn't download Qwen model (HTTP {}). HuggingFace may be rate-limiting; try again in a minute.",
            resp.status().as_u16()
        ));
    }
    let total = resp.content_length();
    on_progress(InstallProgress::DownloadingModel { received: 0, total });
    let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut chunk = [0u8; 256 * 1024];
    let mut received: u64 = 0;
    loop {
        let n = resp.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut out, &chunk[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        on_progress(InstallProgress::DownloadingModel { received, total });
    }
    // Sanity check: GGUF files start with the magic bytes "GGUF".
    let mut header = [0u8; 4];
    let mut f = std::fs::File::open(&target).map_err(|e| e.to_string())?;
    let _ = std::io::Read::read(&mut f, &mut header);
    if &header != b"GGUF" {
        let _ = std::fs::remove_file(&target);
        return Err("Downloaded model is not a valid GGUF file (header mismatch)".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lists_all_engines_missing_in_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let st = status(tmp.path());
        assert_eq!(st.len(), 2);
        let duck = st.iter().find(|e| e.id == "duckdb").unwrap();
        assert!(!duck.installed && duck.required && duck.available);
        let llama = st.iter().find(|e| e.id == "llamacpp").unwrap();
        assert!(!llama.installed && !llama.required);
    }

    #[test]
    #[ignore = "downloads the DuckDB CLI from GitHub releases (network)"]
    fn installs_duckdb() {
        let tmp = tempfile::tempdir().unwrap();
        let path = install(tmp.path(), "duckdb", |_| {}).expect("install");
        assert!(std::path::Path::new(&path).exists());
        assert!(status(tmp.path())
            .iter()
            .any(|e| e.id == "duckdb" && e.installed));
    }
}
