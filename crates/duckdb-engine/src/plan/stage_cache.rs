//! Smart incremental re-run: pure cache-key + cacheability + prune logic.
//!
//! DOM-free, IO-free, deterministic — the correctness core of feature #1,
//! unit-tested in isolation. The engine layer (manifest, parquet read/write,
//! plan rewrite) builds on top of this; nothing here touches the filesystem or
//! DuckDB, so the tricky invalidation rules can be exhaustively tested cheaply.
//!
//! Mirrors the semantics of the frontend `stage-cache.ts` (same cascading-key
//! idea) but adds the two things only the engine knows: an external-input
//! fingerprint (file mtime+size) and a conservative cacheability filter.

use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Everything the cache needs to know about one stage. Built by the engine
/// from a compiled `Stage`; kept abstract so this module stays pure/testable.
#[derive(Debug, Clone)]
pub struct CacheNode {
    pub node_id: String,
    pub component_id: String,
    /// Canonical (order-insensitive) serialization of the node's properties.
    pub canonical_props: String,
    /// `Some((mtime_ns, size_bytes))` for a source reading a local file we can
    /// stat; folded into the key so an on-disk change invalidates without any
    /// graph edit. `None` for non-file stages (no contribution).
    pub external_fingerprint: Option<String>,
    /// Stage runs as plain DuckDB SQL (no RuntimeSpec). Required for caching.
    pub is_pure_sql: bool,
    /// Stage is a sink (side effects) — never cacheable, always runs.
    pub is_sink: bool,
    /// Stage is a source whose input we successfully fingerprinted. A source
    /// with no fingerprint (network DB, HTTP, …) is not cacheable.
    pub source_fingerprinted: bool,
    /// Stage is a source at all (no upstream). Non-sources are judged purely on
    /// purity + upstream cacheability.
    pub is_source: bool,
}

/// A directed edge source -> target between stage node ids.
#[derive(Debug, Clone)]
pub struct CacheEdge {
    pub source: String,
    pub target: String,
}

fn parents_map(nodes: &[CacheNode], edges: &[CacheEdge]) -> HashMap<String, Vec<String>> {
    let mut parents: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes {
        parents.entry(n.node_id.clone()).or_default();
    }
    for e in edges {
        if parents.contains_key(&e.target) {
            parents.entry(e.target.clone()).or_default().push(e.source.clone());
        }
    }
    parents
}

fn children_map(nodes: &[CacheNode], edges: &[CacheEdge]) -> HashMap<String, Vec<String>> {
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes {
        children.entry(n.node_id.clone()).or_default();
    }
    for e in edges {
        if children.contains_key(&e.source) {
            children.entry(e.source.clone()).or_default().push(e.target.clone());
        }
    }
    children
}

/// Deterministic content key per stage. Folds in component_id, canonical props,
/// the external fingerprint, and the SORTED keys of all upstream stages — so
/// any upstream change cascades downstream. Computed in dependency order with a
/// cycle guard (cycles are rejected upstream of here, but we stay terminating).
pub fn compute_keys(nodes: &[CacheNode], edges: &[CacheEdge]) -> HashMap<String, String> {
    let parents = parents_map(nodes, edges);
    let by_id: HashMap<&str, &CacheNode> = nodes.iter().map(|n| (n.node_id.as_str(), n)).collect();
    let mut keys: HashMap<String, String> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();

    fn key_of(
        id: &str,
        parents: &HashMap<String, Vec<String>>,
        by_id: &HashMap<&str, &CacheNode>,
        keys: &mut HashMap<String, String>,
        visiting: &mut HashSet<String>,
    ) -> String {
        if let Some(k) = keys.get(id) {
            return k.clone();
        }
        if visiting.contains(id) {
            return String::new(); // cycle guard
        }
        visiting.insert(id.to_string());
        let node = by_id.get(id);
        let cid = node.map(|n| n.component_id.as_str()).unwrap_or("");
        let props = node.map(|n| n.canonical_props.as_str()).unwrap_or("");
        let fp = node.and_then(|n| n.external_fingerprint.as_deref()).unwrap_or("");
        let mut up_keys: Vec<String> = parents
            .get(id)
            .map(|ps| ps.iter().map(|p| key_of(p, parents, by_id, keys, visiting)).collect())
            .unwrap_or_default();
        up_keys.sort();
        let mut hasher = Sha256::new();
        hasher.update(cid.as_bytes());
        hasher.update([0u8]);
        hasher.update(props.as_bytes());
        hasher.update([0u8]);
        hasher.update(fp.as_bytes());
        hasher.update([0u8]);
        hasher.update(up_keys.join("|").as_bytes());
        let key = format!("{:x}", hasher.finalize());
        visiting.remove(id);
        keys.insert(id.to_string(), key.clone());
        key
    }

    let ids: Vec<String> = nodes.iter().map(|n| n.node_id.clone()).collect();
    for id in &ids {
        key_of(id, &parents, &by_id, &mut keys, &mut visiting);
    }
    keys
}

/// Conservative cacheability filter. A stage is cacheable ONLY if it is pure
/// SQL, not a sink, every upstream is cacheable, and — when it is a source — it
/// was fingerprinted. Anything else is non-cacheable and taints downstream.
/// Deliberately under-caches rather than risk serving stale data.
pub fn cacheable_set(nodes: &[CacheNode], edges: &[CacheEdge]) -> HashSet<String> {
    let parents = parents_map(nodes, edges);
    let by_id: HashMap<&str, &CacheNode> = nodes.iter().map(|n| (n.node_id.as_str(), n)).collect();
    let mut cache: HashMap<String, bool> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();

    fn ok(
        id: &str,
        parents: &HashMap<String, Vec<String>>,
        by_id: &HashMap<&str, &CacheNode>,
        cache: &mut HashMap<String, bool>,
        visiting: &mut HashSet<String>,
    ) -> bool {
        if let Some(v) = cache.get(id) {
            return *v;
        }
        if visiting.contains(id) {
            return false; // cycle -> not cacheable
        }
        visiting.insert(id.to_string());
        let node = match by_id.get(id) {
            Some(n) => *n,
            None => {
                visiting.remove(id);
                cache.insert(id.to_string(), false);
                return false;
            }
        };
        let self_ok = node.is_pure_sql
            && !node.is_sink
            && (!node.is_source || node.source_fingerprinted);
        let parents_ok = parents
            .get(id)
            .map(|ps| ps.iter().all(|p| ok(p, parents, by_id, cache, visiting)))
            .unwrap_or(true);
        let result = self_ok && parents_ok;
        visiting.remove(id);
        cache.insert(id.to_string(), result);
        result
    }

    let mut out = HashSet::new();
    let ids: Vec<String> = nodes.iter().map(|n| n.node_id.clone()).collect();
    for id in &ids {
        if ok(id, &parents, &by_id, &mut cache, &mut visiting) {
            out.insert(id.clone());
        }
    }
    out
}

/// Stages that can be DROPPED from the plan because every consumer is a cache
/// hit (their output is no longer needed at run time). A stage with no
/// consumers (a leaf) is never prunable. A stage feeding any miss or any sink
/// stays. `hits` is the set of node ids being served from cache.
pub fn prunable_set(
    nodes: &[CacheNode],
    edges: &[CacheEdge],
    hits: &HashSet<String>,
) -> HashSet<String> {
    let children = children_map(nodes, edges);
    let mut out = HashSet::new();
    for n in nodes {
        let kids = match children.get(&n.node_id) {
            Some(k) if !k.is_empty() => k,
            _ => continue, // leaf: keep
        };
        // Drop iff every consumer is itself a cache hit (so it reads parquet,
        // not this stage's table/view).
        if kids.iter().all(|c| hits.contains(c)) {
            out.insert(n.node_id.clone());
        }
    }
    // A pruned stage's own upstreams may now also be prunable; iterate to a
    // fixpoint so an entire dead subtree collapses, never dropping a stage that
    // still feeds a surviving (non-hit, non-pruned) consumer.
    loop {
        let mut added = false;
        for n in nodes {
            if out.contains(&n.node_id) {
                continue;
            }
            let kids = match children.get(&n.node_id) {
                Some(k) if !k.is_empty() => k,
                _ => continue,
            };
            if kids.iter().all(|c| hits.contains(c) || out.contains(c)) {
                out.insert(n.node_id.clone());
                added = true;
            }
        }
        if !added {
            break;
        }
    }
    out
}

/// Canonical, order-insensitive JSON stringify for property maps. Object keys
/// sorted recursively; arrays keep order (semantic). Matches the FE
/// `stage-cache.ts` `canonical()` so the two layers agree on what "unchanged"
/// means. Accepts a serde_json::Value.
pub fn canonical_json(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(a) => {
            let inner: Vec<String> = a.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        Value::Object(o) => {
            let sorted: BTreeMap<&String, &Value> = o.iter().collect();
            let inner: Vec<String> = sorted
                .iter()
                .map(|(k, v)| {
                    let ks = serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string());
                    format!("{}:{}", ks, canonical_json(v))
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

/// Build the external fingerprint string for a local file from its metadata.
/// `None` inputs (file missing / not statable) yield `None` so the caller marks
/// the source non-cacheable rather than caching against a phantom.
pub fn file_fingerprint(mtime_ns: Option<u128>, size_bytes: Option<u64>) -> Option<String> {
    match (mtime_ns, size_bytes) {
        (Some(m), Some(s)) => Some(format!("{}:{}", m, s)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(id: &str, props: &str, fp: Option<&str>) -> CacheNode {
        CacheNode {
            node_id: id.to_string(),
            component_id: "src.csv".to_string(),
            canonical_props: props.to_string(),
            external_fingerprint: fp.map(|s| s.to_string()),
            is_pure_sql: true,
            is_sink: false,
            source_fingerprinted: fp.is_some(),
            is_source: true,
        }
    }
    fn xf(id: &str, props: &str) -> CacheNode {
        CacheNode {
            node_id: id.to_string(),
            component_id: "xf.filter".to_string(),
            canonical_props: props.to_string(),
            external_fingerprint: None,
            is_pure_sql: true,
            is_sink: false,
            source_fingerprinted: false,
            is_source: false,
        }
    }
    fn sink(id: &str) -> CacheNode {
        CacheNode {
            node_id: id.to_string(),
            component_id: "snk.csv".to_string(),
            canonical_props: String::new(),
            external_fingerprint: None,
            is_pure_sql: true,
            is_sink: true,
            source_fingerprinted: false,
            is_source: false,
        }
    }
    fn edge(s: &str, t: &str) -> CacheEdge {
        CacheEdge { source: s.to_string(), target: t.to_string() }
    }
    fn hits(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keys_are_stable_across_recomputation() {
        let nodes = vec![src("s", "{\"path\":\"/a.csv\"}", Some("1:10")), xf("f", "{\"e\":\"x>1\"}")];
        let edges = vec![edge("s", "f")];
        let k1 = compute_keys(&nodes, &edges);
        let k2 = compute_keys(&nodes, &edges);
        assert_eq!(k1.get("s"), k2.get("s"));
        assert_eq!(k1.get("f"), k2.get("f"));
    }

    #[test]
    fn config_change_changes_key() {
        let a = vec![src("s", "{\"path\":\"/a.csv\"}", Some("1:10"))];
        let b = vec![src("s", "{\"path\":\"/b.csv\"}", Some("1:10"))];
        assert_ne!(compute_keys(&a, &[]).get("s"), compute_keys(&b, &[]).get("s"));
    }

    #[test]
    fn external_file_change_changes_key() {
        // Same graph/props, different file fingerprint -> key MUST change.
        let a = vec![src("s", "{\"path\":\"/a.csv\"}", Some("100:10"))];
        let b = vec![src("s", "{\"path\":\"/a.csv\"}", Some("200:10"))];
        assert_ne!(compute_keys(&a, &[]).get("s"), compute_keys(&b, &[]).get("s"));
    }

    #[test]
    fn upstream_change_propagates_downstream() {
        let n1 = vec![src("s", "{\"path\":\"/a.csv\"}", Some("1:10")), xf("f", "{\"e\":\"x>1\"}")];
        let n2 = vec![src("s", "{\"path\":\"/b.csv\"}", Some("1:10")), xf("f", "{\"e\":\"x>1\"}")];
        let edges = vec![edge("s", "f")];
        // f's own config is identical, but upstream changed -> f's key changes.
        assert_ne!(
            compute_keys(&n1, &edges).get("f"),
            compute_keys(&n2, &edges).get("f")
        );
    }

    #[test]
    fn independent_branch_unaffected() {
        let n1 = vec![
            src("s1", "{\"path\":\"/a.csv\"}", Some("1:10")),
            src("s2", "{\"path\":\"/x.csv\"}", Some("1:10")),
            xf("f1", "{\"e\":\"x>1\"}"),
            xf("f2", "{\"e\":\"y>1\"}"),
        ];
        let mut n2 = n1.clone();
        n2[0] = src("s1", "{\"path\":\"/CHANGED.csv\"}", Some("1:10"));
        let edges = vec![edge("s1", "f1"), edge("s2", "f2")];
        let k1 = compute_keys(&n1, &edges);
        let k2 = compute_keys(&n2, &edges);
        assert_ne!(k1.get("f1"), k2.get("f1")); // downstream of changed s1
        assert_eq!(k1.get("f2"), k2.get("f2")); // independent branch
    }

    #[test]
    fn cacheable_excludes_sinks_and_unfingerprinted_sources() {
        let nodes = vec![
            src("s", "{}", Some("1:10")),
            src("net", "{}", None), // source with no fingerprint -> not cacheable
            xf("f", "{}"),
            sink("k"),
        ];
        let edges = vec![edge("s", "f"), edge("f", "k")];
        let c = cacheable_set(&nodes, &edges);
        assert!(c.contains("s"));
        assert!(c.contains("f"));
        assert!(!c.contains("k")); // sink
        assert!(!c.contains("net")); // unfingerprinted source
    }

    #[test]
    fn non_cacheable_upstream_taints_downstream() {
        // f reads from an unfingerprinted source -> f is not cacheable either.
        let nodes = vec![src("net", "{}", None), xf("f", "{}")];
        let edges = vec![edge("net", "f")];
        let c = cacheable_set(&nodes, &edges);
        assert!(!c.contains("net"));
        assert!(!c.contains("f"));
    }

    #[test]
    fn runtime_spec_stage_not_cacheable() {
        let mut ai = xf("ai", "{}");
        ai.is_pure_sql = false; // has a RuntimeSpec
        let nodes = vec![src("s", "{}", Some("1:10")), ai, xf("f", "{}")];
        let edges = vec![edge("s", "ai"), edge("ai", "f")];
        let c = cacheable_set(&nodes, &edges);
        assert!(c.contains("s"));
        assert!(!c.contains("ai")); // impure
        assert!(!c.contains("f")); // tainted by impure upstream
    }

    #[test]
    fn prune_drops_stage_whose_only_consumer_is_a_hit() {
        // s -> f -> k. If f is a hit, s's only consumer (f) reads parquet, so s
        // is prunable. f is NOT prunable (its consumer k is not a hit).
        let nodes = vec![src("s", "{}", Some("1:10")), xf("f", "{}"), sink("k")];
        let edges = vec![edge("s", "f"), edge("f", "k")];
        let p = prunable_set(&nodes, &edges, &hits(&["f"]));
        assert!(p.contains("s"));
        assert!(!p.contains("f")); // feeds a non-hit sink
        assert!(!p.contains("k"));
    }

    #[test]
    fn prune_keeps_stage_feeding_a_miss() {
        // s -> f1 (hit), s -> f2 (miss). s feeds a miss, so it must stay.
        let nodes = vec![src("s", "{}", Some("1:10")), xf("f1", "{}"), xf("f2", "{}")];
        let edges = vec![edge("s", "f1"), edge("s", "f2")];
        let p = prunable_set(&nodes, &edges, &hits(&["f1"]));
        assert!(!p.contains("s"));
    }

    #[test]
    fn prune_collapses_dead_subtree_to_fixpoint() {
        // a -> b -> c (hit). c reads parquet, so b prunable, then a prunable.
        let nodes = vec![xf("a", "{}"), xf("b", "{}"), xf("c", "{}")];
        let edges = vec![edge("a", "b"), edge("b", "c")];
        let p = prunable_set(&nodes, &edges, &hits(&["c"]));
        assert!(p.contains("a"));
        assert!(p.contains("b"));
        assert!(!p.contains("c"));
    }

    #[test]
    fn canonical_json_is_order_insensitive() {
        let a: serde_json::Value = serde_json::json!({"path": "/a.csv", "header": true});
        let b: serde_json::Value = serde_json::json!({"header": true, "path": "/a.csv"});
        assert_eq!(canonical_json(&a), canonical_json(&b));
    }

    #[test]
    fn file_fingerprint_requires_both_parts() {
        assert_eq!(file_fingerprint(Some(1), Some(2)), Some("1:2".to_string()));
        assert_eq!(file_fingerprint(None, Some(2)), None);
        assert_eq!(file_fingerprint(Some(1), None), None);
    }
}
