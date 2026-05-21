//! Duckle scheduler.
//!
//! Cron- and interval-based triggers for pipelines. Schedules are
//! persisted to `<workspace>/schedules.json` so they survive restarts.
//! A single tokio task wakes every 15 seconds, decides which schedules
//! are due, and fires each as a non-blocking spawn that calls into the
//! shared `DuckdbEngine`.

use chrono::{DateTime, Utc};
use cron::Schedule as CronSchedule;
use duckle_duckdb_engine::{DuckdbEngine, PipelineDoc, RunResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time;
use tracing::warn;

const SCHEDULES_FILE: &str = "schedules.json";
const TICK_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScheduleKind {
    /// Standard 5-field cron (minute hour day month weekday) or
    /// 6-field with seconds. Whatever the `cron` crate accepts.
    Cron { expr: String },
    /// Fire every N seconds since last run (or app start).
    Interval { seconds: u64 },
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
}

fn default_true() -> bool {
    true
}

#[derive(Clone)]
pub struct Scheduler {
    inner: Arc<Mutex<SchedulerInner>>,
    engine: DuckdbEngine,
}

struct SchedulerInner {
    schedules: Vec<Schedule>,
    workspace_path: Option<PathBuf>,
}

impl Scheduler {
    pub fn new(engine: DuckdbEngine) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SchedulerInner {
                schedules: Vec::new(),
                workspace_path: None,
            })),
            engine,
        }
    }

    /// Switch to a different workspace path. Loads schedules from the
    /// new path; computes next-run times for each.
    pub fn set_workspace(&self, path: Option<PathBuf>) {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        g.workspace_path = path.clone();
        g.schedules = match path {
            Some(p) => load_schedules(&p).unwrap_or_else(|e| {
                warn!("Failed to load schedules: {}", e);
                Vec::new()
            }),
            None => Vec::new(),
        };
        for s in g.schedules.iter_mut() {
            compute_next_run(s);
        }
    }

    pub fn list(&self) -> Vec<Schedule> {
        self.inner
            .lock()
            .expect("scheduler poisoned")
            .schedules
            .clone()
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
        }
        if schedule.id.is_empty() {
            schedule.id = uuid::Uuid::new_v4().to_string();
        }
        compute_next_run(&mut schedule);
        let mut g = self.inner.lock().expect("scheduler poisoned");
        if let Some(idx) = g.schedules.iter().position(|s| s.id == schedule.id) {
            g.schedules[idx] = schedule.clone();
        } else {
            g.schedules.push(schedule.clone());
        }
        if let Some(path) = g.workspace_path.clone() {
            let _ = save_schedules(&path, &g.schedules);
        }
        Ok(schedule)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        g.schedules.retain(|s| s.id != id);
        if let Some(path) = g.workspace_path.clone() {
            let _ = save_schedules(&path, &g.schedules);
        }
        Ok(())
    }

    /// Execute a schedule's pipeline right now, regardless of its
    /// timing. Updates last-run bookkeeping on completion.
    pub async fn run_now(&self, id: &str) -> Result<RunResult, String> {
        let (workspace, pipeline_id) = {
            let g = self.inner.lock().expect("scheduler poisoned");
            let s = g
                .schedules
                .iter()
                .find(|s| s.id == id)
                .ok_or_else(|| "Schedule not found".to_string())?;
            (g.workspace_path.clone(), s.pipeline_id.clone())
        };
        let workspace =
            workspace.ok_or_else(|| "No workspace set for the scheduler".to_string())?;
        let pipeline = load_pipeline(&workspace, &pipeline_id)?;
        let engine = self.engine.clone();
        let started = Utc::now();
        let result = tokio::task::spawn_blocking(move || engine.execute_pipeline(&pipeline))
            .await
            .map_err(|e| e.to_string())?;
        self.record_run(id, started, &result);
        Ok(result)
    }

    fn record_run(&self, id: &str, started: DateTime<Utc>, result: &RunResult) {
        let mut g = self.inner.lock().expect("scheduler poisoned");
        if let Some(s) = g.schedules.iter_mut().find(|s| s.id == id) {
            s.last_run_at = Some(started);
            s.last_run_status = Some(result.status.clone());
            s.last_run_duration_ms = Some(result.duration_ms);
            s.last_run_error = result.error.clone();
            compute_next_run(s);
        }
        if let Some(path) = g.workspace_path.clone() {
            let _ = save_schedules(&path, &g.schedules);
        }
    }

    /// Start the polling task. Returns immediately.
    pub fn spawn_ticker(&self) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut tick = time::interval(TICK_INTERVAL);
            tick.tick().await; // Skip the immediate tick.
            loop {
                tick.tick().await;
                me.fire_due().await;
            }
        });
    }

    async fn fire_due(&self) {
        let now = Utc::now();
        let due: Vec<String> = {
            let g = self.inner.lock().expect("scheduler poisoned");
            g.schedules
                .iter()
                .filter(|s| {
                    s.enabled
                        && matches!(s.next_run_at, Some(t) if t <= now)
                })
                .map(|s| s.id.clone())
                .collect()
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

    #[test]
    fn cron_parses_and_computes_next() {
        let mut s = Schedule {
            id: "t".into(),
            pipeline_id: "p1".into(),
            name: "every minute".into(),
            enabled: true,
            kind: ScheduleKind::Cron {
                expr: "0 * * * * *".into(),
            },
            last_run_at: None,
            last_run_status: None,
            last_run_duration_ms: None,
            last_run_error: None,
            next_run_at: None,
        };
        compute_next_run(&mut s);
        assert!(s.next_run_at.is_some());
        assert!(s.next_run_at.unwrap() > Utc::now());
    }

    #[test]
    fn interval_computes_next() {
        let mut s = Schedule {
            id: "t".into(),
            pipeline_id: "p1".into(),
            name: "every 5".into(),
            enabled: true,
            kind: ScheduleKind::Interval { seconds: 300 },
            last_run_at: None,
            last_run_status: None,
            last_run_duration_ms: None,
            last_run_error: None,
            next_run_at: None,
        };
        compute_next_run(&mut s);
        let next = s.next_run_at.expect("next_run_at set");
        let now = Utc::now();
        let delta = next - now;
        assert!(delta.num_seconds() <= 301 && delta.num_seconds() >= 299);
    }

    #[test]
    fn disabled_clears_next() {
        let mut s = Schedule {
            id: "t".into(),
            pipeline_id: "p1".into(),
            name: "off".into(),
            enabled: false,
            kind: ScheduleKind::Interval { seconds: 60 },
            last_run_at: None,
            last_run_status: None,
            last_run_duration_ms: None,
            last_run_error: None,
            next_run_at: Some(Utc::now()),
        };
        compute_next_run(&mut s);
        assert!(s.next_run_at.is_none());
    }
}
