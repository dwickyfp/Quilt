//! CI build-status poller for the workspace's configured remote.
//!
//! Reads the latest build for the current branch from GitHub Actions
//! or GitLab CI (auto-detected from the remote URL) and returns a
//! tiny status struct the frontend turns into a topbar badge.
//!
//! Auth uses the same PAT the user saved for pushes (see
//! `workspace_git::load_pat`). Without a PAT we still try the public
//! API - works for public repos, 404s / 401s for private ones.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct CiStatus {
    /// "github", "gitlab", "unknown".
    pub provider: String,
    /// "success", "failure", "in_progress", "pending", "cancelled", "none", "unknown".
    pub state: String,
    /// One-line summary the badge tooltip shows.
    pub label: String,
    /// Browser URL for the build (open-in-browser link on click).
    pub url: Option<String>,
    /// Commit SHA the build is for (short form).
    pub sha: Option<String>,
}

impl CiStatus {
    fn none(provider: &str) -> Self {
        CiStatus {
            provider: provider.into(),
            state: "none".into(),
            label: "No builds yet".into(),
            url: None,
            sha: None,
        }
    }
    fn unknown(provider: &str, msg: impl Into<String>) -> Self {
        CiStatus {
            provider: provider.into(),
            state: "unknown".into(),
            label: msg.into(),
            url: None,
            sha: None,
        }
    }
}

/// Fetch latest build status for the current workspace branch.
/// Resolves the remote + branch from the workspace's git config, then
/// dispatches to the GitHub or GitLab path based on the remote host.
pub fn poll(workspace: &Path) -> Result<CiStatus, String> {
    use crate::workspace_git;
    let st = workspace_git::status(workspace)?;
    let Some(remote) = st.remote else {
        return Ok(CiStatus::none("unknown"));
    };
    let branch = st.branch.as_deref().unwrap_or("main");
    let token = workspace_git::load_pat(workspace).ok();
    match remote.provider.as_str() {
        "github" => poll_github(&remote.url, branch, token.as_deref()),
        "gitlab" => poll_gitlab(&remote.url, branch, token.as_deref()),
        other => Ok(CiStatus::unknown(other, "CI status not supported for this provider")),
    }
}

/// `owner/repo` from a GitHub URL. Handles both:
///   https://github.com/owner/repo(.git)?
///   git@github.com:owner/repo.git
fn parse_github_slug(url: &str) -> Option<String> {
    let after = if let Some(s) = url.strip_prefix("https://github.com/") {
        s
    } else if let Some(s) = url.strip_prefix("git@github.com:") {
        s
    } else {
        return None;
    };
    let cleaned = after.trim_end_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = cleaned.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    Some(format!("{}/{}", parts[0], parts[1]))
}

/// `host/path` for GitLab. The project path is URL-encoded into the
/// API call so nested-namespace projects (`group/sub/repo`) work.
fn parse_gitlab(url: &str) -> Option<(String, String)> {
    // https://gitlab.com/group/sub/repo(.git)?
    // git@gitlab.com:group/sub/repo.git
    let (host, path) = if let Some(rest) = url.strip_prefix("https://") {
        let slash = rest.find('/')?;
        (rest[..slash].to_string(), rest[slash + 1..].to_string())
    } else if let Some(rest) = url.strip_prefix("git@") {
        let colon = rest.find(':')?;
        (rest[..colon].to_string(), rest[colon + 1..].to_string())
    } else {
        return None;
    };
    let clean_path = path.trim_end_matches('/').trim_end_matches(".git").to_string();
    Some((host, clean_path))
}

fn poll_github(remote_url: &str, branch: &str, token: Option<&str>) -> Result<CiStatus, String> {
    let slug = parse_github_slug(remote_url).ok_or_else(|| "couldn't parse GitHub URL".to_string())?;
    let api = format!(
        "https://api.github.com/repos/{}/actions/runs?branch={}&per_page=1",
        slug,
        urlencoding_minimal(branch)
    );
    let mut req = ureq::get(&api)
        .set("User-Agent", "duckle-app")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(8));
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {}", t));
    }
    let resp = req.call();
    let body: serde_json::Value = match resp {
        Ok(r) => r.into_json().map_err(|e| format!("github parse: {}", e))?,
        Err(ureq::Error::Status(404, _)) => return Ok(CiStatus::none("github")),
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            return Ok(CiStatus::unknown(
                "github",
                "Auth required - save a PAT in the Git panel",
            ));
        }
        Err(e) => return Err(format!("github transport: {}", e)),
    };
    let run = body
        .pointer("/workflow_runs/0")
        .ok_or_else(|| "no workflow_runs in response".to_string())?;
    let status = run
        .pointer("/status")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let conclusion = run
        .pointer("/conclusion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let state = match (status, conclusion) {
        ("completed", "success") => "success",
        ("completed", "failure") => "failure",
        ("completed", "cancelled") => "cancelled",
        ("completed", _) => "failure",
        ("in_progress", _) => "in_progress",
        ("queued", _) | ("requested", _) | ("waiting", _) => "pending",
        _ => "unknown",
    };
    let url = run
        .pointer("/html_url")
        .and_then(|v| v.as_str())
        .map(String::from);
    let sha = run
        .pointer("/head_sha")
        .and_then(|v| v.as_str())
        .map(|s| s[..s.len().min(7)].to_string());
    let label = format!(
        "GitHub Actions: {} ({})",
        state,
        run.pointer("/name").and_then(|v| v.as_str()).unwrap_or("workflow")
    );
    Ok(CiStatus {
        provider: "github".into(),
        state: state.into(),
        label,
        url,
        sha,
    })
}

fn poll_gitlab(remote_url: &str, branch: &str, token: Option<&str>) -> Result<CiStatus, String> {
    let (host, path) = parse_gitlab(remote_url).ok_or_else(|| "couldn't parse GitLab URL".to_string())?;
    let project_id = urlencoding_full(&path);
    let api = format!(
        "https://{}/api/v4/projects/{}/pipelines?ref={}&per_page=1",
        host,
        project_id,
        urlencoding_minimal(branch)
    );
    let mut req = ureq::get(&api)
        .set("User-Agent", "duckle-app")
        .timeout(Duration::from_secs(8));
    if let Some(t) = token {
        // GitLab uses PRIVATE-TOKEN header (not Bearer).
        req = req.set("PRIVATE-TOKEN", t);
    }
    let resp = req.call();
    let body: serde_json::Value = match resp {
        Ok(r) => r.into_json().map_err(|e| format!("gitlab parse: {}", e))?,
        Err(ureq::Error::Status(404, _)) => return Ok(CiStatus::none("gitlab")),
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            return Ok(CiStatus::unknown(
                "gitlab",
                "Auth required - save a PAT in the Git panel",
            ));
        }
        Err(e) => return Err(format!("gitlab transport: {}", e)),
    };
    let arr = body.as_array().cloned().unwrap_or_default();
    let pipeline = match arr.first() {
        Some(p) => p,
        None => return Ok(CiStatus::none("gitlab")),
    };
    let status = pipeline
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let state = match status {
        "success" => "success",
        "failed" => "failure",
        "canceled" | "cancelled" => "cancelled",
        "running" => "in_progress",
        "pending" | "created" | "waiting_for_resource" | "scheduled" => "pending",
        "skipped" | "manual" => "pending",
        _ => "unknown",
    };
    let url = pipeline
        .get("web_url")
        .and_then(|v| v.as_str())
        .map(String::from);
    let sha = pipeline
        .get("sha")
        .and_then(|v| v.as_str())
        .map(|s| s[..s.len().min(7)].to_string());
    Ok(CiStatus {
        provider: "gitlab".into(),
        state: state.into(),
        label: format!("GitLab CI: {}", state),
        url,
        sha,
    })
}

/// Conservative URL-encoder used for query parameter values.
fn urlencoding_minimal(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            '/' => "%2F".to_string(),
            other => format!("%{:02X}", other as u32),
        })
        .collect()
}

/// Full URL-encoder for the GitLab project path (slashes must be %2F).
fn urlencoding_full(s: &str) -> String {
    urlencoding_minimal(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_github_slug_handles_both_forms() {
        assert_eq!(
            parse_github_slug("https://github.com/SouravRoy-ETL/duckle.git").as_deref(),
            Some("SouravRoy-ETL/duckle")
        );
        assert_eq!(
            parse_github_slug("https://github.com/SouravRoy-ETL/duckle").as_deref(),
            Some("SouravRoy-ETL/duckle")
        );
        assert_eq!(
            parse_github_slug("git@github.com:SouravRoy-ETL/duckle.git").as_deref(),
            Some("SouravRoy-ETL/duckle")
        );
        assert!(parse_github_slug("https://gitlab.com/foo/bar").is_none());
    }

    #[test]
    fn parse_gitlab_handles_nested_groups() {
        assert_eq!(
            parse_gitlab("https://gitlab.com/group/sub/project.git"),
            Some(("gitlab.com".into(), "group/sub/project".into()))
        );
        assert_eq!(
            parse_gitlab("git@gitlab.internal:team/repo.git"),
            Some(("gitlab.internal".into(), "team/repo".into()))
        );
    }

    #[test]
    fn urlencoding_replaces_slashes_and_specials() {
        assert_eq!(urlencoding_full("foo/bar"), "foo%2Fbar");
        assert_eq!(urlencoding_minimal("feature/x"), "feature%2Fx");
        assert_eq!(urlencoding_minimal("my branch"), "my%20branch");
    }
}
