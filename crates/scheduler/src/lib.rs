//! Quilt scheduler.
//!
//! Cron- and interval-based triggers for pipelines. Schedules are
//! persisted to `<workspace>/schedules.json` so they survive restarts.
//! A single tokio task wakes every 15 seconds, decides which schedules
//! are due, and fires each as a non-blocking spawn that calls into the
//! shared `DuckdbEngine`.

use chrono::{DateTime, Utc};
use cron::Schedule as CronSchedule;
use quilt_duckdb_engine::{
    append_run_record, DuckdbEngine, PipelineDoc, RunRecord, RunResult,
};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::time;
use tracing::warn;

const SCHEDULES_FILE: &str = "schedules.json";
const TICK_INTERVAL: Duration = Duration::from_secs(15);
const WATCH_DEBOUNCE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScheduleKind {
    /// Standard 5-field cron (minute hour day month weekday) or
    /// 6-field with seconds. Whatever the `cron` crate accepts.
    Cron { expr: String },
    /// Fire every N seconds since last run (or app start).
    Interval { seconds: u64 },
    /// Fire when a file or folder changes (debounced ~2s).
    FileWatch {
        path: String,
        #[serde(default)]
        recursive: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub pipeline_id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub kind: ScheduleKind,
    #[serde(default)]
    pub last_run_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_run_status: Option<String>,
    #[serde(default)]
    pub last_run_duration_ms: Option<u64>,
    #[serde(default)]
    pub last_run_error: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<DateTime<Utc>>,
    /// Which workspace folder this schedule lives in. Not persisted in a
    /// meaningful way (overwritten from the on-disk location on load); it
    /// rides the IPC boundary so the frontend can route schedules to the
    /// right workspace when several are open at once.
    #[serde(default)]
    pub workspace_path: Option<String>,
}

fn default_true() -> bool {
    true
}

/// One open workspace's schedules. Each workspace persists its own
/// `schedules.json`; the scheduler holds a group per open workspace so
/// schedules in a non-focused workspace still fire to their own folder.
struct WorkspaceGroup {
    path: PathBuf,
    schedules: Vec<Schedule>,
}

#[derive(Clone)]
pub struct Scheduler {
    inner: Arc<Mutex<SchedulerInner>>,
    engine: DuckdbEngine,
    fire_tx: UnboundedSender<String>,
}

struct SchedulerInner {
    /// One group per open workspace. Schedules across all groups are
    /// evaluated every tick and fired against their OWN workspace.
    groups: Vec<WorkspaceGroup>,
    /// The focused workspace - used as the baseline process env so manual
    /// (foreground) actions and child-pipeline resolution default here.
    active_path: Option<PathBuf>,
    /// Active file-watchers, keyed by schedule id (globally unique uuid).
    /// Holding the `Debouncer` keeps the watch alive; dropping it stops.
    watchers: HashMap<String, Debouncer<RecommendedWatcher>>,
    /// Receiver for file-watch fires; taken by `spawn_ticker`.
    fire_rx: Option<UnboundedReceiver<String>>,
}

/// Point the process env at a workspace so the engine resolves child
/// pipelines, the stage cache, and run logs under it. Centralized here so
/// scheduled fires (which run headless, in this crate) and the desktop's
/// active-workspace baseline use identical semantics.
pub fn apply_workspace_env(path: Option<&Path>) {
    match path {
        Some(p) => {
            std::env::set_var("QUILT_WORKSPACE", p);
            std::env::set_var("QUILT_LOG_DIR", p.join("logs"));
            std::env::set_var("QUILT_STAGE_CACHE_DIR", p.join("cache"));
        }
        None => {
            std::env::remove_var("QUILT_WORKSPACE");
            std::env::remove_var("QUILT_LOG_DIR");
            std::env::remove_var("QUILT_STAGE_CACHE_DIR");
        }
    }
}

impl Scheduler {
    pub fn new(engine: DuckdbEngine) -> Self {
        let (fire_tx, fire_rx) = unbounded_channel();
        Self {
            inner: Arc::new(Mutex::new(SchedulerInner {
                groups: Vec::new(),
                active_path: None,
                watchers: HashMap::new(),
                fire_rx: Some(fire_rx),
            })),
            engine,
            fire_tx,
        }
    }

    /// Register the full set of open workspaces. Each one's
    /// `schedules.json` is loaded so schedules in ANY open workspace fire
    /// to their own folder. `active` is the focused workspace, published
    /// to the process env as the baseline for foreground actions.
    ///
    /// Groups already loaded for a still-open path are KEPT (preserving
    /// in-memory next-run claims) rather than reloaded, so opening or
    /// switching a workspace never resets another's firing cadence.
    pub fn set_workspaces(&self, paths: Vec<PathBuf>, active: Option<PathBuf>) {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        let mut existing: HashMap<PathBuf, WorkspaceGroup> =
            g.groups.drain(..).map(|grp| (grp.path.clone(), grp)).collect();
        let mut groups = Vec::with_capacity(paths.len());
        for p in paths {
            if let Some(grp) = existing.remove(&p) {
                groups.push(grp); // keep runtime state
                continue;
            }
            let mut schedules = load_schedules(&p).unwrap_or_else(|e| {
                warn!("Failed to load schedules for {}: {}", p.display(), e);
                Vec::new()
            });
            let label = p.to_string_lossy().to_string();
            for s in schedules.iter_mut() {
                s.workspace_path = Some(label.clone());
                compute_next_run(s);
            }
            groups.push(WorkspaceGroup { path: p, schedules });
        }
        g.groups = groups;
        g.active_path = active.clone();
        apply_workspace_env(active.as_deref());
        self.rebuild_watchers(&mut g);
    }

    /// Back-compat single-workspace entry point: register exactly one
    /// workspace (or none) as both the only group and the active one.
    pub fn set_workspace(&self, path: Option<PathBuf>) {
        match path {
            Some(p) => self.set_workspaces(vec![p.clone()], Some(p)),
            None => self.set_workspaces(Vec::new(), None),
        }
    }

    /// Recreate file-watchers for the current schedule set. Drops all
    /// existing watchers and rebuilds from enabled FileWatch
    /// schedules.
    fn rebuild_watchers(&self, inner: &mut SchedulerInner) {
        inner.watchers.clear();
        let specs: Vec<(String, String, bool)> = inner
            .groups
            .iter()
            .flat_map(|grp| grp.schedules.iter())
            .filter(|s| s.enabled)
            .filter_map(|s| match &s.kind {
                ScheduleKind::FileWatch { path, recursive } => {
                    Some((s.id.clone(), path.clone(), *recursive))
                }
                _ => None,
            })
            .collect();
        for (id, path, recursive) in specs {
            match self.make_watcher(&id, &path, recursive) {
                Ok(w) => {
                    inner.watchers.insert(id, w);
                }
                Err(e) => warn!("File-watch setup failed for {}: {}", id, e),
            }
        }
    }

    fn make_watcher(
        &self,
        schedule_id: &str,
        path: &str,
        recursive: bool,
    ) -> notify::Result<Debouncer<RecommendedWatcher>> {
        let tx = self.fire_tx.clone();
        let sid = schedule_id.to_string();
        let mut debouncer = new_debouncer(WATCH_DEBOUNCE, move |res: DebounceEventResult| {
            if let Ok(events) = res {
                if !events.is_empty() {
                    let _ = tx.send(sid.clone());
                }
            }
        })?;
        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        debouncer.watcher().watch(Path::new(path), mode)?;
        Ok(debouncer)
    }

    /// All schedules across every open workspace, each stamped with its
    /// owning `workspace_path` so the frontend can group/route them.
    pub fn list(&self) -> Vec<Schedule> {
        let g = self.inner.lock().expect("scheduler poisoned");
        g.groups
            .iter()
            .flat_map(|grp| {
                let label = grp.path.to_string_lossy().to_string();
                grp.schedules.iter().map(move |s| {
                    let mut s = s.clone();
                    s.workspace_path = Some(label.clone());
                    s
                })
            })
            .collect()
    }

    pub fn upsert(&self, mut schedule: Schedule) -> Result<Schedule, String> {
        match &schedule.kind {
            ScheduleKind::Cron { expr } => {
                CronSchedule::from_str(expr)
                    .map_err(|e| format!("Invalid cron expression: {}", e))?;
            }
            ScheduleKind::Interval { seconds } => {
                if *seconds < 1 {
                    return Err("Interval must be at least 1 second".into());
                }
            }
            ScheduleKind::FileWatch { path, .. } => {
                if path.trim().is_empty() {
                    return Err("Watch path is required".into());
                }
            }
        }
        if schedule.id.is_empty() {
            schedule.id = uuid::Uuid::new_v4().to_string();
        }
        compute_next_run(&mut schedule);
        let mut g = self.inner.lock().expect("scheduler poisoned");
        // Pick the target workspace group: the one named on the schedule if
        // open, else the active workspace, else the only open group.
        let target = pick_group_index(&g, schedule.workspace_path.as_deref())
            .ok_or_else(|| "No workspace open for this schedule".to_string())?;
        let path = g.groups[target].path.clone();
        schedule.workspace_path = Some(path.to_string_lossy().to_string());
        {
            let schedules = &mut g.groups[target].schedules;
            if let Some(idx) = schedules.iter().position(|s| s.id == schedule.id) {
                schedules[idx] = schedule.clone();
            } else {
                schedules.push(schedule.clone());
            }
            let _ = save_schedules(&path, schedules);
        }
        self.rebuild_watchers(&mut g);
        Ok(schedule)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        // Find the owning group, remove there, persist that workspace only.
        for grp in g.groups.iter_mut() {
            if let Some(pos) = grp.schedules.iter().position(|s| s.id == id) {
                grp.schedules.remove(pos);
                let _ = save_schedules(&grp.path, &grp.schedules);
                break;
            }
        }
        g.watchers.remove(id);
        Ok(())
    }

    /// Execute a schedule's pipeline right now, regardless of its
    /// timing. Runs against the schedule's OWN workspace (sets the process
    /// env to that folder for the duration), so a schedule in a
    /// non-focused workspace still resolves its pipeline + child refs +
    /// cache + logs under its own folder. Updates last-run bookkeeping.
    pub async fn run_now(&self, id: &str) -> Result<RunResult, String> {
        let (workspace, pipeline_id) = {
            let g = self.inner.lock().expect("scheduler poisoned");
            let (grp, s) = g
                .groups
                .iter()
                .find_map(|grp| grp.schedules.iter().find(|s| s.id == id).map(|s| (grp, s)))
                .ok_or_else(|| "Schedule not found".to_string())?;
            (grp.path.clone(), s.pipeline_id.clone())
        };
        let pipeline = load_pipeline(&workspace, &pipeline_id)?;
        let engine = self.engine.clone();
        let started = Utc::now();
        // Log scheduled runs under the pipeline id (the scheduler has no
        // friendly name handy) so they still land in the per-pipeline log.
        let log_name = pipeline_id.clone();
        // Point the engine's env at THIS schedule's workspace just before
        // the run so child-pipeline resolution / stage cache / run logs all
        // land in the right folder, even for a non-focused workspace. Then
        // restore the active workspace as the baseline.
        let active = {
            let g = self.inner.lock().expect("scheduler poisoned");
            g.active_path.clone()
        };
        apply_workspace_env(Some(&workspace));
        let result =
            tokio::task::spawn_blocking(move || engine.execute_pipeline_named(&pipeline, &log_name))
                .await
                .map_err(|e| e.to_string())?;
        apply_workspace_env(active.as_deref());
        self.record_run(id, started, &result);
        Ok(result)
    }

    fn record_run(&self, id: &str, started: DateTime<Utc>, result: &RunResult) {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        let mut found: Option<(PathBuf, String)> = None;
        for grp in g.groups.iter_mut() {
            if let Some(s) = grp.schedules.iter_mut().find(|s| s.id == id) {
                s.last_run_at = Some(started);
                s.last_run_status = Some(result.status.clone());
                s.last_run_duration_ms = Some(result.duration_ms);
                s.last_run_error = result.error.clone();
                let pid = s.pipeline_id.clone();
                compute_next_run(s);
                let _ = save_schedules(&grp.path, &grp.schedules);
                found = Some((grp.path.clone(), pid));
                break;
            }
        }
        // Append to the pipeline's run history under its own workspace.
        if let Some((path, pid)) = found {
            let record = RunRecord::from_result(result, "scheduled");
            let _ = append_run_record(&path, &pid, record);
        }
    }

    /// Start the polling task and the file-watch fire listener.
    /// Returns immediately.
    pub fn spawn_ticker(&self) {
        // Cron / interval poller.
        let me = self.clone();
        tokio::spawn(async move {
            let mut tick = time::interval(TICK_INTERVAL);
            tick.tick().await; // Skip the immediate tick.
            loop {
                tick.tick().await;
                me.fire_due().await;
            }
        });

        // File-watch fire listener - drains the channel watchers post to.
        let rx = {
            let mut g = self.inner.lock().expect("scheduler poisoned");
            g.fire_rx.take()
        };
        if let Some(mut rx) = rx {
            let me = self.clone();
            tokio::spawn(async move {
                while let Some(id) = rx.recv().await {
                    let me2 = me.clone();
                    tokio::spawn(async move {
                        if let Err(e) = me2.run_now(&id).await {
                            warn!("File-watch run {} failed: {}", id, e);
                        }
                    });
                }
            });
        }
    }

    async fn fire_due(&self) {
        let now = Utc::now();
        let due: Vec<String> = {
            let mut g = self.inner.lock().expect("scheduler poisoned");
            let mut due = Vec::new();
            for s in g.groups.iter_mut().flat_map(|grp| grp.schedules.iter_mut()) {
                if s.enabled && matches!(s.next_run_at, Some(t) if t <= now) {
                    due.push(s.id.clone());
                    // Claim the occurrence immediately, under the lock, by
                    // advancing next_run_at to the next FUTURE time. The
                    // tick wakes every 15s and run_now only recomputes
                    // next_run_at on completion (record_run); without this
                    // claim a run slower than 15s gets re-fired every tick.
                    // Advancing (vs clearing to None) keeps the schedule
                    // firing on cadence even if this run errors before
                    // record_run.
                    claim_next_run(s, now);
                }
            }
            due
        };
        for id in due {
            let me = self.clone();
            tokio::spawn(async move {
                if let Err(e) = me.run_now(&id).await {
                    warn!("Scheduled run {} failed: {}", id, e);
                }
            });
        }
    }
}

/// Choose which open workspace group an upserted schedule belongs to.
/// Preference order: the workspace named on the schedule (if still open),
/// then the active workspace, then the sole open group. Returns None when
/// no workspace is open at all.
fn pick_group_index(inner: &SchedulerInner, named: Option<&str>) -> Option<usize> {
    if inner.groups.is_empty() {
        return None;
    }
    if let Some(name) = named.filter(|s| !s.is_empty()) {
        let np = PathBuf::from(name);
        if let Some(i) = inner.groups.iter().position(|g| g.path == np) {
            return Some(i);
        }
    }
    if let Some(active) = inner.active_path.as_ref() {
        if let Some(i) = inner.groups.iter().position(|g| &g.path == active) {
            return Some(i);
        }
    }
    Some(0)
}

/// Advance next_run_at to the next occurrence strictly after `now`.
/// Used to "claim" a due schedule at dispatch so the 15s ticker can't
/// re-fire a still-running schedule. Unlike compute_next_run (which for
/// intervals is anchored on last_run_at and can still be in the past for
/// an overdue run), this is always anchored on `now`, guaranteeing a
/// future time.
fn claim_next_run(s: &mut Schedule, now: DateTime<Utc>) {
    s.next_run_at = match &s.kind {
        ScheduleKind::Cron { expr } => CronSchedule::from_str(expr)
            .ok()
            .and_then(|sched| sched.after(&now).next()),
        ScheduleKind::Interval { seconds } => {
            Some(now + chrono::Duration::seconds(*seconds as i64))
        }
        ScheduleKind::FileWatch { .. } => None,
    };
}

fn compute_next_run(s: &mut Schedule) {
    if !s.enabled {
        s.next_run_at = None;
        return;
    }
    s.next_run_at = match &s.kind {
        ScheduleKind::Cron { expr } => CronSchedule::from_str(expr)
            .ok()
            .and_then(|sched| sched.upcoming(Utc).next()),
        ScheduleKind::Interval { seconds } => {
            let base = s.last_run_at.unwrap_or_else(Utc::now);
            Some(base + chrono::Duration::seconds(*seconds as i64))
        }
        // Event-driven - no scheduled next-run time.
        ScheduleKind::FileWatch { .. } => None,
    };
}

fn schedules_path(workspace: &PathBuf) -> PathBuf {
    workspace.join(SCHEDULES_FILE)
}

fn load_schedules(workspace: &PathBuf) -> Result<Vec<Schedule>, String> {
    let p = schedules_path(workspace);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let parsed: Vec<Schedule> =
        serde_json::from_str(&content).map_err(|e| format!("Parse schedules.json: {}", e))?;
    Ok(parsed)
}

fn save_schedules(workspace: &PathBuf, schedules: &[Schedule]) -> Result<(), String> {
    let p = schedules_path(workspace);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(schedules).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| e.to_string())
}

fn load_pipeline(workspace: &PathBuf, pipeline_id: &str) -> Result<PipelineDoc, String> {
    let p = workspace
        .join("pipelines")
        .join(format!("{}.json", pipeline_id));
    let content =
        std::fs::read_to_string(&p).map_err(|e| format!("Read pipeline file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse pipeline file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sched(id: &str, pipeline_id: &str, kind: ScheduleKind) -> Schedule {
        Schedule {
            id: id.into(),
            pipeline_id: pipeline_id.into(),
            name: id.into(),
            enabled: true,
            kind,
            last_run_at: None,
            last_run_status: None,
            last_run_duration_ms: None,
            last_run_error: None,
            next_run_at: None,
            workspace_path: None,
        }
    }

    fn engine() -> DuckdbEngine {
        // The registry tests never execute a pipeline, so a CLI path that
        // need not exist is fine - construction doesn't touch the binary.
        DuckdbEngine::new(PathBuf::from("duckdb"))
    }

    #[test]
    fn cron_parses_and_computes_next() {
        let mut s = sched("t", "p1", ScheduleKind::Cron { expr: "0 * * * * *".into() });
        compute_next_run(&mut s);
        assert!(s.next_run_at.is_some());
        assert!(s.next_run_at.unwrap() > Utc::now());
    }

    #[test]
    fn interval_computes_next() {
        let mut s = sched("t", "p1", ScheduleKind::Interval { seconds: 300 });
        compute_next_run(&mut s);
        let next = s.next_run_at.expect("next_run_at set");
        let now = Utc::now();
        let delta = next - now;
        assert!(delta.num_seconds() <= 301 && delta.num_seconds() >= 299);
    }

    #[test]
    fn disabled_clears_next() {
        let mut s = sched("t", "p1", ScheduleKind::Interval { seconds: 60 });
        s.enabled = false;
        s.next_run_at = Some(Utc::now());
        compute_next_run(&mut s);
        assert!(s.next_run_at.is_none());
    }

    // ---- Multi-workspace registry --------------------------------------

    #[test]
    fn set_workspaces_loads_every_open_workspace() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let pb = b.path().to_path_buf();
        save_schedules(&pa, &[sched("a1", "pa", ScheduleKind::Interval { seconds: 60 })]).unwrap();
        save_schedules(&pb, &[sched("b1", "pb", ScheduleKind::Interval { seconds: 60 })]).unwrap();

        let s = Scheduler::new(engine());
        s.set_workspaces(vec![pa.clone(), pb.clone()], Some(pa.clone()));

        let all = s.list();
        assert_eq!(all.len(), 2, "both workspaces' schedules are loaded");
        let a1 = all.iter().find(|x| x.id == "a1").unwrap();
        let b1 = all.iter().find(|x| x.id == "b1").unwrap();
        // Each schedule is stamped with its OWN workspace path.
        assert_eq!(a1.workspace_path.as_deref(), Some(pa.to_string_lossy().as_ref()));
        assert_eq!(b1.workspace_path.as_deref(), Some(pb.to_string_lossy().as_ref()));
    }

    #[test]
    fn upsert_routes_to_named_workspace_and_persists_there_only() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let pb = b.path().to_path_buf();
        let s = Scheduler::new(engine());
        // Active is A, but the new schedule names B -> must land in B.
        s.set_workspaces(vec![pa.clone(), pb.clone()], Some(pa.clone()));

        let mut draft = sched("", "pb_pipe", ScheduleKind::Interval { seconds: 120 });
        draft.workspace_path = Some(pb.to_string_lossy().to_string());
        let saved = s.upsert(draft).unwrap();
        assert_eq!(saved.workspace_path.as_deref(), Some(pb.to_string_lossy().as_ref()));

        // Persisted into B's schedules.json, NOT A's.
        let in_b = load_schedules(&pb).unwrap();
        let in_a = load_schedules(&pa).unwrap();
        assert_eq!(in_b.len(), 1);
        assert_eq!(in_b[0].pipeline_id, "pb_pipe");
        assert!(in_a.is_empty(), "workspace A's schedules.json untouched");
    }

    #[test]
    fn upsert_without_named_workspace_falls_back_to_active() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let pb = b.path().to_path_buf();
        let s = Scheduler::new(engine());
        s.set_workspaces(vec![pa.clone(), pb.clone()], Some(pb.clone()));

        // No workspace_path on the draft -> active (B) wins.
        let saved = s.upsert(sched("", "x", ScheduleKind::Interval { seconds: 60 })).unwrap();
        assert_eq!(saved.workspace_path.as_deref(), Some(pb.to_string_lossy().as_ref()));
        assert_eq!(load_schedules(&pb).unwrap().len(), 1);
        assert!(load_schedules(&pa).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_from_owning_workspace_only() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let pb = b.path().to_path_buf();
        save_schedules(&pa, &[sched("a1", "pa", ScheduleKind::Interval { seconds: 60 })]).unwrap();
        save_schedules(&pb, &[sched("b1", "pb", ScheduleKind::Interval { seconds: 60 })]).unwrap();
        let s = Scheduler::new(engine());
        s.set_workspaces(vec![pa.clone(), pb.clone()], Some(pa.clone()));

        s.delete("b1").unwrap();
        assert!(load_schedules(&pb).unwrap().is_empty(), "B's schedule removed from disk");
        assert_eq!(load_schedules(&pa).unwrap().len(), 1, "A's schedule untouched");
        assert_eq!(s.list().len(), 1);
    }

    #[test]
    fn set_workspaces_preserves_runtime_state_for_still_open_paths() {
        let a = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let s = Scheduler::new(engine());
        s.set_workspaces(vec![pa.clone()], Some(pa.clone()));
        s.upsert(sched("k", "p", ScheduleKind::Interval { seconds: 60 })).unwrap();
        let before = s.list()[0].next_run_at;

        // Re-register the same path alongside a new one: A's group is kept,
        // so its claimed next_run_at is preserved (not recomputed).
        let b = tempfile::tempdir().unwrap();
        s.set_workspaces(vec![pa.clone(), b.path().to_path_buf()], Some(pa.clone()));
        let after = s.list().iter().find(|x| x.id == "k").unwrap().next_run_at;
        assert_eq!(before, after, "re-registering keeps the existing run cadence");
    }

    #[test]
    fn closing_a_workspace_drops_its_schedules_from_the_active_set() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let pa = a.path().to_path_buf();
        let pb = b.path().to_path_buf();
        save_schedules(&pa, &[sched("a1", "pa", ScheduleKind::Interval { seconds: 60 })]).unwrap();
        save_schedules(&pb, &[sched("b1", "pb", ScheduleKind::Interval { seconds: 60 })]).unwrap();
        let s = Scheduler::new(engine());
        s.set_workspaces(vec![pa.clone(), pb.clone()], Some(pa.clone()));
        assert_eq!(s.list().len(), 2);

        // Close B (re-register with only A): B's schedules no longer fire,
        // but B's schedules.json on disk is left intact.
        s.set_workspaces(vec![pa.clone()], Some(pa.clone()));
        assert_eq!(s.list().len(), 1);
        assert_eq!(s.list()[0].id, "a1");
        assert_eq!(load_schedules(&pb).unwrap().len(), 1, "closed workspace's file preserved");
    }
}
