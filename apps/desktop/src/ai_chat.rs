//! AI chat assistant backed by a hosted provider.
//!
//! Supports three providers, all reached over HTTPS with the user's
//! API key (configured in the frontend Settings page and passed in per
//! request):
//!   - OpenAI            -> {base}/v1/chat/completions  (Bearer auth)
//!   - OpenAI-compatible -> same wire format, custom base URL
//!   - Claude            -> {base}/v1/messages          (x-api-key)
//!
//! Tokens are streamed back to the frontend over a Tauri Channel as
//! `ChatEvent`s. The OpenAI and OpenAI-compatible paths share one SSE
//! parse loop; Claude has its own event shape.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// System prompt that teaches the model to emit Quilt pipeline JSON when
/// the user asks for one. Lists the most common component IDs.
pub const SYSTEM_PROMPT: &str = r#"You are Qunnie, the AI assistant inside Quilt (a local-first ETL/ELT studio). When the user asks for a pipeline, output ONE valid JSON pipeline definition inside a ```json fenced code block, then a one-sentence summary.

Pipeline schema:
{
  "nodes": [
    { "id": "<unique-id>", "type": "<component-id>", "data": { "label": "<display name>", "props": {...} } }
  ],
  "edges": [
    { "id": "<edge-id>", "source": "<node-id>", "target": "<node-id>", "sourceHandle": "main", "targetHandle": "main" }
  ]
}

Common component IDs (use exactly these strings):
- Sources: src.csv, src.json, src.parquet, src.excel, src.postgres, src.mysql, src.sqlite, src.duckdb, src.s3, src.rest, src.git, src.dynamodb, src.kinesis, src.email, src.ftp, src.webhook
- Transforms: xf.filter, xf.select, xf.rename, xf.aggregate, xf.join, xf.lookup, xf.sort, xf.distinct, xf.union, xf.cast, xf.derive, xf.ai.embed, xf.ai.llm, xf.ai.classify, xf.ai.chunk, xf.ai.pii, xf.ai.dedupe
- Sinks: snk.csv, snk.json, snk.parquet, snk.postgres, snk.mysql, snk.s3, snk.email, snk.rest, snk.webhook
- Code: code.sql, code.shell, code.javascript, code.wasm
- Machine Learning: ml.partition (train/test split; main output = train, test output = test), ml.learner.linreg, ml.learner.logreg, ml.learner.tree, ml.learner.forest, ml.learner.knn, ml.learner.kmeans (Learners output a model on the `model` port), ml.predict (data on main + model on the model port -> appends prediction), ml.score (actualColumn + predictedColumn -> metrics table), ml.model.writer (model on the model port -> exports the trained model to a file: classic ML as portable JSON, ONNX copied as-is; prop path = output file)
- Deep Learning: dl.onnx.reader (path to .onnx -> model port), dl.onnx.predict (data on main + model on model port -> appends prediction)

ML wiring: connect the training data into a Learner's main input; connect the Learner's `model` output port to a Predictor's `model` input port (use sourceHandle "model" / targetHandle "model"). A typical flow: src -> ml.partition; partition main -> learner -> (model) predict; partition test -> predict main; predict -> ml.score. To export a model for other platforms, connect a Learner's or dl.onnx.reader's `model` output port to ml.model.writer's `model` input port.

Connect sources to transforms to sinks via main edges. Keep IDs short (s1, t1, k1). Props are component-specific; for files use {"path": "..."}, for filters use {"predicate": "col > 5"}, for SQL use {"sql": "SELECT ..."}.

If the user is just chatting, reply conversationally without JSON.
"#;

/// Anthropic Messages API version header value.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// One streamed event the frontend reads off a Tauri Channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatEvent {
    /// One token (or short text run) from the model.
    Token { text: String },
    /// Conversation finished cleanly.
    Done,
    /// Something broke mid-stream - send to the user as an error toast.
    Error { message: String },
}

/// One message in a chat conversation. Matches OpenAI's shape.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Which hosted provider a request targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Claude,
    OpenAiCompatible,
}

impl Provider {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "openai" => Ok(Provider::OpenAi),
            "claude" => Ok(Provider::Claude),
            "openai-compatible" => Ok(Provider::OpenAiCompatible),
            other => Err(format!("unknown AI provider '{}'", other)),
        }
    }
}

fn trim_base(base_url: &str) -> &str {
    base_url.trim().trim_end_matches('/')
}

/// Send a user message + prior history to the configured provider and
/// stream tokens out via the `on_event` callback as they arrive. The
/// system prompt is prepended automatically.
pub fn chat_stream<F: FnMut(ChatEvent)>(
    provider: Provider,
    api_key: &str,
    base_url: &str,
    model: &str,
    history: &[ChatMessage],
    on_event: F,
) -> Result<(), String> {
    match provider {
        Provider::OpenAi | Provider::OpenAiCompatible => {
            openai_stream(api_key, base_url, model, history, on_event)
        }
        Provider::Claude => claude_stream(api_key, base_url, model, history, on_event),
    }
}

/// OpenAI (and OpenAI-compatible) streaming chat completions.
fn openai_stream<F: FnMut(ChatEvent)>(
    api_key: &str,
    base_url: &str,
    model: &str,
    history: &[ChatMessage],
    mut on_event: F,
) -> Result<(), String> {
    let mut messages: Vec<serde_json::Value> = Vec::with_capacity(history.len() + 1);
    messages.push(serde_json::json!({ "role": "system", "content": SYSTEM_PROMPT }));
    for m in history {
        messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
    }
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "temperature": 0.2,
        "top_p": 0.9,
    });
    let url = format!("{}/v1/chat/completions", trim_base(base_url));
    let mut req = ureq::post(&url)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(300));
    // Only send Authorization when a key is set. OpenAI-compatible local
    // servers (Ollama, LM Studio, llama.cpp) often need no key and some
    // reject a malformed `Bearer ` with an empty token.
    if !api_key.trim().is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", api_key));
    }
    let resp = req
        .send_string(&body.to_string())
        .map_err(format_ureq_err)?;
    let reader = BufReader::new(resp.into_reader());
    // OpenAI-style SSE: each event is a "data: <json>" line. The final
    // line is "data: [DONE]". Empty lines separate events.
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Some(payload) = line.strip_prefix("data: ") else {
            continue;
        };
        if payload.trim() == "[DONE]" {
            on_event(ChatEvent::Done);
            return Ok(());
        }
        let chunk: serde_json::Value = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let text = chunk
            .pointer("/choices/0/delta/content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !text.is_empty() {
            on_event(ChatEvent::Token { text: text.to_string() });
        }
        // Some servers don't emit [DONE]; finish_reason ends the stream.
        if chunk
            .pointer("/choices/0/finish_reason")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .is_some()
        {
            on_event(ChatEvent::Done);
            return Ok(());
        }
    }
    on_event(ChatEvent::Done);
    Ok(())
}

/// Claude (Anthropic Messages API) streaming. The system prompt goes in
/// a top-level `system` field; only user/assistant turns go in
/// `messages`. SSE events carry a `type` discriminator.
fn claude_stream<F: FnMut(ChatEvent)>(
    api_key: &str,
    base_url: &str,
    model: &str,
    history: &[ChatMessage],
    mut on_event: F,
) -> Result<(), String> {
    let messages: Vec<serde_json::Value> = history
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 2048,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "stream": true,
        "temperature": 0.2,
    });
    let url = format!("{}/v1/messages", trim_base(base_url));
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .set("x-api-key", api_key)
        .set("anthropic-version", ANTHROPIC_VERSION)
        .timeout(Duration::from_secs(300))
        .send_string(&body.to_string())
        .map_err(format_ureq_err)?;
    let reader = BufReader::new(resp.into_reader());
    // Anthropic SSE interleaves `event: <name>` and `data: <json>`
    // lines. We only need the data payloads; the JSON's `type` tells us
    // what each one is.
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Some(payload) = line.strip_prefix("data: ") else {
            continue;
        };
        let chunk: serde_json::Value = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match chunk.get("type").and_then(|v| v.as_str()) {
            Some("content_block_delta") => {
                let text = chunk
                    .pointer("/delta/text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !text.is_empty() {
                    on_event(ChatEvent::Token { text: text.to_string() });
                }
            }
            Some("message_stop") => {
                on_event(ChatEvent::Done);
                return Ok(());
            }
            Some("error") => {
                let msg = chunk
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Claude stream error")
                    .to_string();
                on_event(ChatEvent::Error { message: msg.clone() });
                return Err(msg);
            }
            _ => {}
        }
    }
    on_event(ChatEvent::Done);
    Ok(())
}

/// Probe the provider with one tiny non-streamed request to validate the
/// key / base URL / model. Returns Ok(()) on any 2xx response.
pub fn test_connection(
    provider: Provider,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<(), String> {
    let (url, builder, body) = match provider {
        Provider::OpenAi | Provider::OpenAiCompatible => {
            let url = format!("{}/v1/chat/completions", trim_base(base_url));
            let body = serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": "ping" }],
                "max_tokens": 1,
                "stream": false,
            });
            let b = ureq::post(&url)
                .set("Content-Type", "application/json");
            let b = if api_key.trim().is_empty() {
                b
            } else {
                b.set("Authorization", &format!("Bearer {}", api_key))
            };
            (url, b, body)
        }
        Provider::Claude => {
            let url = format!("{}/v1/messages", trim_base(base_url));
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{ "role": "user", "content": "ping" }],
            });
            let b = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("x-api-key", api_key)
                .set("anthropic-version", ANTHROPIC_VERSION);
            (url, b, body)
        }
    };
    let _ = url;
    builder
        .timeout(Duration::from_secs(30))
        .send_string(&body.to_string())
        .map(|_| ())
        .map_err(format_ureq_err)
}

/// Turn a ureq error into a readable message. HTTP error responses
/// (4xx/5xx) carry the provider's JSON error body, which usually names
/// the real problem (bad key, unknown model); surface it.
fn format_ureq_err(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp
                .into_string()
                .unwrap_or_else(|_| String::from("(no response body)"));
            // Try to pull a human message out of the provider's JSON.
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    v.pointer("/error/message")
                        .or_else(|| v.pointer("/error"))
                        .or_else(|| v.pointer("/message"))
                        .and_then(|m| m.as_str().map(|s| s.to_string()))
                })
                .unwrap_or(body);
            format!("HTTP {}: {}", code, detail.trim())
        }
        ureq::Error::Transport(t) => format!("network error: {}", t),
    }
}

/// Pull a JSON pipeline definition out of an assistant message.
/// Looks for a ```json fenced code block and parses its contents
/// as { nodes, edges }. Returns Err if no JSON block, parse fails,
/// or the shape doesn't match.
pub fn extract_pipeline(assistant_text: &str) -> Result<serde_json::Value, String> {
    let lower = assistant_text.to_ascii_lowercase();
    let start = lower
        .find("```json")
        .or_else(|| lower.find("```"))
        .ok_or_else(|| "no fenced code block found".to_string())?;
    let after_fence = &assistant_text[start..];
    let body_start = after_fence
        .find('\n')
        .map(|n| start + n + 1)
        .ok_or_else(|| "unterminated code-block opener".to_string())?;
    let body_after = &assistant_text[body_start..];
    let end = body_after
        .find("```")
        .ok_or_else(|| "unterminated code block".to_string())?;
    let body = &body_after[..end];
    let parsed: serde_json::Value =
        serde_json::from_str(body.trim()).map_err(|e| format!("JSON parse: {}", e))?;
    if !parsed.get("nodes").map(|v| v.is_array()).unwrap_or(false) {
        return Err("pipeline JSON missing `nodes` array".into());
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pipeline_pulls_json_from_fenced_block() {
        let text = "Sure! Here's a CSV-to-Parquet pipeline:\n\n```json\n{\n  \"nodes\": [{\"id\":\"s\",\"type\":\"src.csv\"},{\"id\":\"k\",\"type\":\"snk.parquet\"}],\n  \"edges\": [{\"source\":\"s\",\"target\":\"k\"}]\n}\n```\n\nLet me know if you want to add a filter.";
        let pipe = extract_pipeline(text).expect("should parse");
        assert_eq!(pipe["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(pipe["edges"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn extract_pipeline_handles_unmarked_fence() {
        let text = "```\n{\"nodes\":[{\"id\":\"a\"}]}\n```";
        let pipe = extract_pipeline(text).expect("should parse");
        assert_eq!(pipe["nodes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn extract_pipeline_errors_when_no_fence() {
        assert!(extract_pipeline("just chatting, no pipeline here").is_err());
    }

    #[test]
    fn extract_pipeline_errors_when_no_nodes() {
        let text = "```json\n{\"not_a_pipeline\": true}\n```";
        assert!(extract_pipeline(text).is_err());
    }

    #[test]
    fn provider_parse_roundtrip() {
        assert_eq!(Provider::parse("openai").unwrap(), Provider::OpenAi);
        assert_eq!(Provider::parse("claude").unwrap(), Provider::Claude);
        assert_eq!(
            Provider::parse("openai-compatible").unwrap(),
            Provider::OpenAiCompatible
        );
        assert!(Provider::parse("bogus").is_err());
    }

    #[test]
    fn trim_base_strips_trailing_slash() {
        assert_eq!(trim_base("https://api.openai.com/"), "https://api.openai.com");
        assert_eq!(trim_base("  https://x.y/  "), "https://x.y");
    }
}
