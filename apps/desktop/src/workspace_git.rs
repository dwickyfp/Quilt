//! In-app Git integration for the user's workspace folder.
//!
//! Connect a workspace to a remote (GitHub / GitLab),
//! commit + push + pull from inside Quilt, manage branches, see CI
//! build status. Wraps the system `git` CLI rather than embedding
//! libgit2 - same pattern as `src.git` in the engine. Trade-off:
//! requires `git` on PATH, but no FFI / no large dep, and the user
//! sees errors in `git`'s own wording.
//!
//! Auth strategy follows the user's preference:
//!   1. Try without explicit credentials first (lets the system
//!      credential helper / GitHub CLI / etc. handle it).
//!   2. On 401 / 403 from the remote, prompt the frontend for a
//!      Personal Access Token, retry by injecting the token into
//!      the remote URL: `https://x-token-auth:TOKEN@github.com/...`.
//!   3. Cache the PAT at `<workspace>/.quilt/secrets/git.json`.
//!      Auto-write a `.quilt/.gitignore` so the secret file never
//!      ends up committed.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// One file's status in the working tree.
#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    /// One of: "staged", "modified", "untracked", "conflicted",
    /// "deleted", "renamed".
    pub status: String,
}

/// Git remote configured for the workspace.
#[derive(Debug, Clone, Serialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
    /// Detected from the URL host: "github", "gitlab", "bitbucket",
    /// or "other".
    pub provider: String,
}

/// Full snapshot the frontend renders.
#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub initialized: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub remote: Option<GitRemote>,
    pub files: Vec<ChangedFile>,
    pub has_pat: bool,
}

/// Errors are flattened to strings for the Tauri channel.
type GitResult<T> = Result<T, String>;

fn detect_provider(url: &str) -> String {
    let lower = url.to_lowercase();
    if lower.contains("github.com") {
        "github".into()
    } else if lower.contains("gitlab.com") || lower.contains("gitlab.") {
        "gitlab".into()
    } else if lower.contains("bitbucket") {
        "bitbucket".into()
    } else {
        "other".into()
    }
}

fn git_cmd(workspace: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(workspace);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: suppress console flash on Windows.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn run_git(workspace: &Path, args: &[&str]) -> GitResult<String> {
    let out = git_cmd(workspace)
        .args(args)
        .output()
        .map_err(|e| format!("spawn git {:?}: {}", args, e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).into_owned();
        return Err(format!("git {:?} failed: {}", args, err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Probe whether the workspace folder is a git repo.
fn is_repo(workspace: &Path) -> bool {
    git_cmd(workspace)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Parse `git status --porcelain=v1 -b` into a structured snapshot.
/// Format: the first line is "## branch...origin/branch [ahead N, behind M]";
/// subsequent lines are "XY path".
fn parse_status(text: &str) -> (Option<String>, u32, u32, Vec<ChangedFile>) {
    let mut branch: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut files: Vec<ChangedFile> = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if i == 0 && line.starts_with("## ") {
            let rest = &line[3..];
            // "branch...origin/branch [ahead 1, behind 2]"
            // or "branch...origin/branch"
            // or "No commits yet on branch"
            // or "HEAD (no branch)"
            let head = rest.split("...").next().unwrap_or(rest);
            let head_clean = head.split_whitespace().next().unwrap_or("");
            if !head_clean.is_empty() && head_clean != "HEAD" {
                branch = Some(head_clean.to_string());
            } else if let Some(rest2) = rest.strip_prefix("No commits yet on ") {
                branch = Some(rest2.split_whitespace().next().unwrap_or("").to_string());
            }
            if let Some(rest_after_bracket) = rest.split_once('[') {
                let bracket = rest_after_bracket.1.trim_end_matches(']');
                for piece in bracket.split(',') {
                    let p = piece.trim();
                    if let Some(n) = p.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = p.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let (xy, rest) = line.split_at(2);
        let path = rest.trim().to_string();
        let status = match xy {
            "??" => "untracked",
            "UU" | "AA" | "DD" => "conflicted",
            " D" | "D " => "deleted",
            " M" => "modified",
            "M " | "MM" => "staged",
            "A " | "AM" => "staged",
            "R " => "renamed",
            _ if xy.starts_with(' ') => "modified",
            _ => "staged",
        };
        files.push(ChangedFile {
            path,
            status: status.into(),
        });
    }
    (branch, ahead, behind, files)
}

/// Build the full status snapshot the frontend renders.
pub fn status(workspace: &Path) -> GitResult<GitStatus> {
    if !workspace.exists() {
        return Err(format!("workspace {} doesn't exist", workspace.display()));
    }
    if !is_repo(workspace) {
        return Ok(GitStatus {
            initialized: false,
            branch: None,
            ahead: 0,
            behind: 0,
            remote: None,
            files: Vec::new(),
            has_pat: pat_path(workspace).exists(),
        });
    }
    let raw = run_git(workspace, &["status", "--porcelain=v1", "-b"])?;
    let (branch, ahead, behind, files) = parse_status(&raw);
    // Remote (origin only for v1).
    let remote = run_git(workspace, &["config", "--get", "remote.origin.url"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|url| GitRemote {
            name: "origin".into(),
            provider: detect_provider(&url),
            url,
        });
    Ok(GitStatus {
        initialized: true,
        branch,
        ahead,
        behind,
        remote,
        files,
        has_pat: pat_path(workspace).exists(),
    })
}

pub fn init(workspace: &Path) -> GitResult<()> {
    if !workspace.exists() {
        return Err(format!("workspace {} doesn't exist", workspace.display()));
    }
    run_git(workspace, &["init", "-b", "main"])?;
    write_gitignore_safety(workspace);
    Ok(())
}

#[allow(dead_code)] // Exposed for future "Clone repo into..." flow.
pub fn clone(parent: &Path, url: &str, folder_name: &str) -> GitResult<PathBuf> {
    if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let dest = parent.join(folder_name);
    let out = git_cmd(parent)
        .args(["clone", url, folder_name])
        .output()
        .map_err(|e| format!("spawn git clone: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    write_gitignore_safety(&dest);
    Ok(dest)
}

pub fn add_all(workspace: &Path) -> GitResult<()> {
    run_git(workspace, &["add", "-A"])?;
    Ok(())
}

pub fn commit(workspace: &Path, message: &str) -> GitResult<String> {
    // Configure author from git config if available; otherwise let
    // git complain - we don't auto-fabricate identities.
    let out = git_cmd(workspace)
        .args(["commit", "-m", message])
        .output()
        .map_err(|e| format!("spawn git commit: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "commit failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Push the current branch. On the first attempt, run `git push`
/// straight through - if the user has a credential helper / GitHub CLI
/// configured the push succeeds with no further prompt. On 401-style
/// failures, the frontend asks the user for a PAT and we retry with
/// the token injected into the URL.
pub fn push(workspace: &Path) -> GitResult<String> {
    let out = git_cmd(workspace)
        .args(["push"])
        .output()
        .map_err(|e| format!("spawn git push: {}", e))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let err = String::from_utf8_lossy(&out.stderr).into_owned();
    // If we have a saved PAT, retry with it before surfacing the
    // auth-required signal to the user.
    if looks_like_auth_failure(&err) {
        if let Ok(token) = load_pat(workspace) {
            return push_with_pat(workspace, &token);
        }
        return Err(format!("AUTH_REQUIRED: {}", err.trim()));
    }
    Err(format!("push failed: {}", err.trim()))
}

/// Retry the push with the PAT supplied out-of-band. The token is passed to
/// git through an environment variable consumed by an inline credential
/// helper, so it never appears in the process argument list (which is
/// world-readable via `ps` / `/proc/<pid>/cmdline`). We don't rewrite the
/// remote, so `git remote -v` stays clean.
fn push_with_pat(workspace: &Path, token: &str) -> GitResult<String> {
    let url = run_git(workspace, &["config", "--get", "remote.origin.url"])?;
    let url = url.trim();
    if !url.to_lowercase().starts_with("https://") {
        return Err(
            "PAT auth only supported for https:// remotes; switch your remote or push from a terminal"
                .to_string(),
        );
    }
    let branch = run_git(workspace, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch.trim();
    // The argv only references $QUILT_GIT_PAT; the secret itself stays in the
    // environment (readable only by the same user, unlike argv). The leading
    // empty `credential.helper=` clears any system helper so only ours runs.
    let helper = "!f() { test \"$1\" = get && printf 'username=x-token-auth\\npassword=%s\\n' \"$QUILT_GIT_PAT\"; }; f";
    let helper_cfg = format!("credential.helper={}", helper);
    let out = git_cmd(workspace)
        .env("QUILT_GIT_PAT", token)
        .args([
            "-c",
            "credential.helper=",
            "-c",
            &helper_cfg,
            "push",
            "origin",
            branch,
        ])
        .output()
        .map_err(|e| format!("spawn git push (PAT): {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "push (with PAT) failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stderr).into_owned())
}

pub fn pull(workspace: &Path) -> GitResult<String> {
    let out = git_cmd(workspace)
        .args(["pull", "--ff-only"])
        .output()
        .map_err(|e| format!("spawn git pull: {}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).into_owned();
        return Err(format!("pull failed: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn branches(workspace: &Path) -> GitResult<Vec<String>> {
    let raw = run_git(workspace, &["branch", "--list", "--format=%(refname:short)"])?;
    Ok(raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

pub fn branch_create(workspace: &Path, name: &str) -> GitResult<()> {
    reject_option_like(name, "branch name")?;
    run_git(workspace, &["checkout", "-b", name])?;
    Ok(())
}

pub fn branch_checkout(workspace: &Path, name: &str) -> GitResult<()> {
    reject_option_like(name, "branch name")?;
    run_git(workspace, &["checkout", name])?;
    Ok(())
}

pub fn remote_set(workspace: &Path, url: &str) -> GitResult<()> {
    // Reject transports other than https:// and SSH. Git honors `ext::`,
    // `fd::`, and `file://` "remote helper" URLs that execute an arbitrary
    // command on the next fetch/push, so an attacker-supplied remote like
    // `ext::sh -c '...'` would be RCE. Only plain https and SSH remotes are
    // allowed; anything else is refused.
    let lower = url.trim().to_lowercase();
    let is_https = lower.starts_with("https://");
    // scp-style `git@host:path` or explicit ssh:// URLs.
    let is_ssh = lower.starts_with("ssh://")
        || (!lower.contains("://") && url.contains('@') && url.contains(':'));
    if !(is_https || is_ssh) {
        return Err(
            "remote URL must be an https:// or SSH URL (other transports are not allowed)".into(),
        );
    }
    // Add origin if missing, set-url otherwise. The scheme check above already
    // guarantees the url can't begin with `-`, so it can't be read as an option.
    let exists = run_git(workspace, &["remote", "get-url", "origin"]).is_ok();
    if exists {
        run_git(workspace, &["remote", "set-url", "origin", url])?;
    } else {
        run_git(workspace, &["remote", "add", "origin", url])?;
    }
    Ok(())
}

// ---- PAT storage ---------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
struct StoredPat {
    pat: String,
}

fn pat_path(workspace: &Path) -> PathBuf {
    workspace.join(".quilt").join("secrets").join("git.json")
}

/// Persist a PAT for later push retries. The token is encrypted with the
/// per-workspace key (the same key the connection secrets use), and a
/// `.quilt/.gitignore` excludes the secrets + keys dirs so neither enters
/// the user's repo. Encryption is mandatory: if the key can't be created or
/// the token can't be encrypted we refuse to write rather than fall back to
/// storing the token in plaintext.
pub fn save_pat(workspace: &Path, token: &str) -> GitResult<()> {
    let path = pat_path(workspace);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let key = crate::secrets::workspace_key(workspace, true)
        .map_err(|e| format!("cannot derive workspace key to encrypt PAT: {}", e))?;
    let stored = crate::secrets::encrypt_value(&key, token)
        .map_err(|e| format!("cannot encrypt PAT: {}", e))?;
    let body = serde_json::to_string_pretty(&StoredPat { pat: stored }).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("write {}: {}", path.display(), e))?;
    write_gitignore_safety(workspace);
    // Tighten file perms on Unix so other local users can't read it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn load_pat(workspace: &Path) -> GitResult<String> {
    let path = pat_path(workspace);
    let body = std::fs::read_to_string(&path).map_err(|e| format!("read PAT: {}", e))?;
    let parsed: StoredPat = serde_json::from_str(&body).map_err(|e| format!("parse PAT: {}", e))?;
    // Decrypt if it was stored encrypted; a legacy plaintext token loads as-is.
    if crate::secrets::is_encrypted(&parsed.pat) {
        if let Ok(key) = crate::secrets::workspace_key(workspace, false) {
            if let Ok(plain) = crate::secrets::decrypt_value(&key, &parsed.pat) {
                return Ok(plain);
            }
        }
    }
    Ok(parsed.pat)
}

pub fn clear_pat(workspace: &Path) -> GitResult<()> {
    let path = pat_path(workspace);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove PAT: {}", e))?;
    }
    Ok(())
}

/// Ensure `<workspace>/.quilt/.gitignore` excludes the `secrets/` dir (cached
/// PAT) and the `keys/` dir (the connection-secret encryption key). The
/// encrypted `connections/` files are safe to commit; the key is not.
/// Idempotent - only adds a line if it is missing.
pub(crate) fn write_gitignore_safety(workspace: &Path) {
    let dir = workspace.join(".quilt");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(".gitignore");
    let mut existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut changed = false;
    for need in ["secrets/", "keys/"] {
        if !existing.lines().any(|l| l.trim() == need) {
            if existing.is_empty() {
                existing = format!("{}\n", need);
            } else {
                existing = format!("{}\n{}\n", existing.trim_end(), need);
            }
            changed = true;
        }
    }
    if changed {
        let _ = std::fs::write(&path, existing);
    }
}

/// Reject a value that would be parsed by git as an option (leading `-`).
/// Guards positional arguments like branch names from option-injection.
fn reject_option_like(value: &str, label: &str) -> GitResult<()> {
    if value.trim_start().starts_with('-') {
        return Err(format!("invalid {}: must not start with '-'", label));
    }
    Ok(())
}

fn looks_like_auth_failure(stderr: &str) -> bool {
    let l = stderr.to_lowercase();
    l.contains("authentication failed")
        || l.contains("could not read username")
        || l.contains("403")
        || l.contains("401")
        || l.contains("permission denied")
        // GitHub's wording: "remote: Permission to org/repo.git denied to user."
        || l.contains("permission to ")
        || l.contains("invalid username or password")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_provider_works() {
        assert_eq!(detect_provider("https://github.com/foo/bar.git"), "github");
        assert_eq!(detect_provider("git@github.com:foo/bar.git"), "github");
        assert_eq!(detect_provider("https://gitlab.com/foo/bar"), "gitlab");
        assert_eq!(detect_provider("https://gitlab.internal/foo"), "gitlab");
        assert_eq!(detect_provider("https://bitbucket.org/foo"), "bitbucket");
        assert_eq!(detect_provider("https://example.com/repo.git"), "other");
    }

    #[test]
    fn parse_status_pulls_branch_and_files() {
        // Clean tree on main.
        let (branch, a, b, files) = parse_status("## main...origin/main\n");
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(a, 0);
        assert_eq!(b, 0);
        assert!(files.is_empty());
    }

    #[test]
    fn parse_status_with_ahead_behind() {
        let (branch, a, b, _) = parse_status("## main...origin/main [ahead 3, behind 1]\n");
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(a, 3);
        assert_eq!(b, 1);
    }

    #[test]
    fn parse_status_classifies_changes() {
        let raw = "## feature/x...origin/feature/x\n M src/lib.rs\nA  new.txt\n?? notes.md\nUU conflicted.txt\n";
        let (branch, _, _, files) = parse_status(raw);
        assert_eq!(branch.as_deref(), Some("feature/x"));
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[1].status, "staged");
        assert_eq!(files[2].status, "untracked");
        assert_eq!(files[3].status, "conflicted");
    }

    #[test]
    fn reject_option_like_blocks_dash_prefix() {
        assert!(reject_option_like("--upload-pack=evil", "branch name").is_err());
        assert!(reject_option_like("-x", "branch name").is_err());
        assert!(reject_option_like("feature/ok", "branch name").is_ok());
        assert!(reject_option_like("main", "branch name").is_ok());
    }

    #[test]
    fn looks_like_auth_failure_catches_common_messages() {
        assert!(looks_like_auth_failure(
            "remote: Invalid username or password"
        ));
        assert!(looks_like_auth_failure(
            "fatal: Authentication failed for 'https://...'"
        ));
        assert!(looks_like_auth_failure(
            "remote: Permission to foo/bar denied"
        ));
        assert!(!looks_like_auth_failure(
            "fatal: refusing to merge unrelated histories"
        ));
    }
}
