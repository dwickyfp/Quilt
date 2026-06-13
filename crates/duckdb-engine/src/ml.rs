//! Machine-learning runtime runners (impl DuckdbEngine).
//!
//! Classic ML via smartcore (pure Rust): ml.learner.* trains a model and
//! persists it as a one-row table keyed by the learner's node id; ml.predict
//! loads that table and appends predictions; ml.score compares actual vs
//! predicted and emits a metrics table. Models serialize with bincode and are
//! base64-encoded so they round-trip cleanly through a DuckDB VARCHAR cell -
//! the same materialize/run_rows plumbing every other runtime node uses, so no
//! separate on-disk artifact store is needed.
//!
//! Child module of the crate root, so self.run_rows / self.bin / the
//! materialize helpers are reachable.

use crate::*;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;

use smartcore::cluster::kmeans::{KMeans, KMeansParameters};
use smartcore::ensemble::random_forest_classifier::{
    RandomForestClassifier, RandomForestClassifierParameters,
};
use smartcore::linalg::basic::matrix::DenseMatrix;
use smartcore::linear::linear_regression::{LinearRegression, LinearRegressionParameters};
use smartcore::linear::logistic_regression::{LogisticRegression, LogisticRegressionParameters};
use smartcore::metrics::distance::euclidian::Euclidian;
use smartcore::neighbors::knn_classifier::{KNNClassifier, KNNClassifierParameters};
use smartcore::tree::decision_tree_classifier::{
    DecisionTreeClassifier, DecisionTreeClassifierParameters,
};

/// Column where a learner stashes the serialized model bundle.
const MODEL_COLUMN: &str = "__quilt_model";

type Matrix = DenseMatrix<f64>;

/// Classifiers learn on integer-encoded class labels and remember the
/// original string labels so predictions decode back to the user's values.
/// Regressors and clustering carry no label map.
#[derive(Serialize, Deserialize)]
enum Model {
    LinReg {
        features: Vec<String>,
        model: LinearRegression<f64, f64, Matrix, Vec<f64>>,
    },
    LogReg {
        features: Vec<String>,
        labels: Vec<String>,
        model: LogisticRegression<f64, i64, Matrix, Vec<i64>>,
    },
    Tree {
        features: Vec<String>,
        labels: Vec<String>,
        model: DecisionTreeClassifier<f64, i64, Matrix, Vec<i64>>,
    },
    Forest {
        features: Vec<String>,
        labels: Vec<String>,
        model: RandomForestClassifier<f64, i64, Matrix, Vec<i64>>,
    },
    Knn {
        features: Vec<String>,
        labels: Vec<String>,
        model: KNNClassifier<f64, i64, Matrix, Vec<i64>, Euclidian<f64>>,
    },
    KMeans {
        features: Vec<String>,
        model: KMeans<f64, i64, Matrix, Vec<i64>>,
    },
}

impl Model {
    fn features(&self) -> &[String] {
        match self {
            Model::LinReg { features, .. }
            | Model::LogReg { features, .. }
            | Model::Tree { features, .. }
            | Model::Forest { features, .. }
            | Model::Knn { features, .. }
            | Model::KMeans { features, .. } => features,
        }
    }
}

/// One numeric feature value out of a JSON cell. Booleans map to 0/1, numeric
/// strings parse, everything non-numeric becomes 0.0 (the column is treated as
/// absent for that row rather than failing the whole run).
fn cell_to_f64(v: Option<&JsonValue>) -> f64 {
    match v {
        Some(JsonValue::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(JsonValue::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(JsonValue::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// Resolve the feature column list: the user's explicit list, or every numeric
/// column except the target when left blank.
fn resolve_features(
    rows: &[JsonValue],
    requested: &[String],
    target: &str,
) -> Result<Vec<String>, EngineError> {
    if !requested.is_empty() {
        return Ok(requested.to_vec());
    }
    let first = rows
        .first()
        .and_then(|r| r.as_object())
        .ok_or_else(|| EngineError::Query("ml: input has no columns".into()))?;
    let cols: Vec<String> = first
        .iter()
        .filter(|(k, v)| {
            k.as_str() != target && matches!(v, JsonValue::Number(_) | JsonValue::Bool(_))
        })
        .map(|(k, _)| k.clone())
        .collect();
    if cols.is_empty() {
        return Err(EngineError::Config(
            "ml: no numeric feature columns found; set featureColumns explicitly".into(),
        ));
    }
    Ok(cols)
}

/// Build the feature matrix from the given columns. Callers guarantee non-empty
/// input (DenseMatrix::from_2d_vec panics on an empty vector).
fn build_matrix(rows: &[JsonValue], features: &[String]) -> Matrix {
    let data: Vec<Vec<f64>> = rows
        .iter()
        .map(|row| features.iter().map(|c| cell_to_f64(row.get(c))).collect())
        .collect();
    DenseMatrix::from_2d_vec(&data)
}

/// Encode a target column to integer class labels. Returns (encoded, label
/// table) where the label table maps class index -> original string.
fn encode_labels(rows: &[JsonValue], target: &str) -> (Vec<i64>, Vec<String>) {
    let mut labels: Vec<String> = Vec::new();
    let encoded: Vec<i64> = rows
        .iter()
        .map(|row| {
            let raw = label_of(row.get(target));
            match labels.iter().position(|l| l == &raw) {
                Some(i) => i as i64,
                None => {
                    labels.push(raw);
                    (labels.len() - 1) as i64
                }
            }
        })
        .collect();
    (encoded, labels)
}

/// Canonical string form of a label cell, shared by encoder and scorer.
fn label_of(v: Option<&JsonValue>) -> String {
    match v {
        Some(JsonValue::String(s)) => s.clone(),
        Some(JsonValue::Number(n)) => n.to_string(),
        Some(JsonValue::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn fit_failed(e: smartcore::error::Failed) -> EngineError {
    EngineError::Query(format!("ml: model fit failed: {}", e))
}

/// Map integer class predictions back to their original string labels.
fn decode_class_preds(preds: Vec<i64>, labels: &[String]) -> Vec<JsonValue> {
    preds
        .into_iter()
        .map(|p| {
            labels
                .get(p as usize)
                .map(|s| json!(s))
                .unwrap_or_else(|| json!(p))
        })
        .collect()
}

impl DuckdbEngine {
    /// ml.learner.*: train a model and store it as a one-row table named after
    /// this node so the downstream Predictor (which reads via the model edge)
    /// can load it.
    pub(crate) fn run_ml_learner(
        &self,
        db: &Path,
        spec: &plan::MlLearnerSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.learner.{}: no training rows from {}",
                spec.algorithm, spec.from_view
            )));
        }

        // k-means is unsupervised: no target column excluded from features.
        let target = if spec.algorithm == "kmeans" {
            ""
        } else {
            spec.target_column.as_str()
        };
        let features = resolve_features(&rows, &spec.feature_columns, target)?;
        let x = build_matrix(&rows, &features);

        let model = match spec.algorithm.as_str() {
            "linreg" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let m = LinearRegression::fit(&x, &y, LinearRegressionParameters::default())
                    .map_err(fit_failed)?;
                Model::LinReg { features, model: m }
            }
            "logreg" => {
                let (y, labels) = encode_labels(&rows, &spec.target_column);
                let m = LogisticRegression::fit(&x, &y, LogisticRegressionParameters::default())
                    .map_err(fit_failed)?;
                Model::LogReg {
                    features,
                    labels,
                    model: m,
                }
            }
            "tree" => {
                let (y, labels) = encode_labels(&rows, &spec.target_column);
                let params = DecisionTreeClassifierParameters::default()
                    .with_max_depth(spec.max_depth.max(1) as u16);
                let m = DecisionTreeClassifier::fit(&x, &y, params).map_err(fit_failed)?;
                Model::Tree {
                    features,
                    labels,
                    model: m,
                }
            }
            "forest" => {
                let (y, labels) = encode_labels(&rows, &spec.target_column);
                let params = RandomForestClassifierParameters::default()
                    .with_n_trees(spec.n_trees.max(1) as u16)
                    .with_max_depth(spec.max_depth.max(1) as u16);
                let m = RandomForestClassifier::fit(&x, &y, params).map_err(fit_failed)?;
                Model::Forest {
                    features,
                    labels,
                    model: m,
                }
            }
            "knn" => {
                let (y, labels) = encode_labels(&rows, &spec.target_column);
                let params = KNNClassifierParameters::default().with_k(spec.k.max(1));
                let m = KNNClassifier::fit(&x, &y, params).map_err(fit_failed)?;
                Model::Knn {
                    features,
                    labels,
                    model: m,
                }
            }
            "kmeans" => {
                let params = KMeansParameters::default()
                    .with_k(spec.k.max(1))
                    .with_max_iter(spec.max_iter.max(1));
                let m = KMeans::fit(&x, params).map_err(fit_failed)?;
                Model::KMeans { features, model: m }
            }
            other => {
                return Err(EngineError::Config(format!(
                    "ml.learner: unknown algorithm '{}'",
                    other
                )))
            }
        };

        let bytes = bincode::serialize(&model)
            .map_err(|e| EngineError::Query(format!("ml: serialize model: {}", e)))?;
        let encoded = B64.encode(bytes);
        let nfeat = model.features().len();
        // One-row table: column __quilt_model holds the base64 bundle.
        let model_row = json!({ MODEL_COLUMN: encoded });
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &[model_row])?;
        Ok(format!(
            "ml.learner.{}: trained on {} rows, {} features -> {}",
            spec.algorithm,
            rows.len(),
            nfeat,
            spec.node_id
        ))
    }

    /// ml.predict: load the upstream Learner's model and append a prediction
    /// column to each input row.
    pub(crate) fn run_ml_predict(
        &self,
        db: &Path,
        spec: &plan::MlPredictSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let model = self.load_model(db, &spec.model_node_id)?;
        let mut rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &[])?;
            return Ok(format!("ml.predict: 0 rows -> {}", spec.node_id));
        }
        let features = model.features().to_vec();
        let x = build_matrix(&rows, &features);

        // Classifiers decode integer labels back to strings; regressor and
        // k-means emit their numeric output directly.
        let preds: Vec<JsonValue> = match &model {
            Model::LinReg { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::LogReg { model, labels, .. } => {
                decode_class_preds(model.predict(&x).map_err(fit_failed)?, labels)
            }
            Model::Tree { model, labels, .. } => {
                decode_class_preds(model.predict(&x).map_err(fit_failed)?, labels)
            }
            Model::Forest { model, labels, .. } => {
                decode_class_preds(model.predict(&x).map_err(fit_failed)?, labels)
            }
            Model::Knn { model, labels, .. } => {
                decode_class_preds(model.predict(&x).map_err(fit_failed)?, labels)
            }
            Model::KMeans { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|c| json!(c))
                .collect(),
        };

        for (row, pred) in rows.iter_mut().zip(preds.into_iter()) {
            if let Some(obj) = row.as_object_mut() {
                obj.insert(spec.output_column.clone(), pred);
            }
        }
        let count = rows.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &rows)?;
        Ok(format!("ml.predict: {} rows -> {}", count, spec.node_id))
    }

    /// ml.score: emit a metrics table comparing actual vs predicted.
    pub(crate) fn run_ml_score(
        &self,
        db: &Path,
        spec: &plan::MlScoreSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.score: no rows from {}",
                spec.from_view
            )));
        }

        let metrics: Vec<JsonValue> = if spec.task == "regression" {
            let actual: Vec<f64> = rows
                .iter()
                .map(|r| cell_to_f64(r.get(&spec.actual_column)))
                .collect();
            let predicted: Vec<f64> = rows
                .iter()
                .map(|r| cell_to_f64(r.get(&spec.predicted_column)))
                .collect();
            let rmse = smartcore::metrics::mean_squared_error(&actual, &predicted).sqrt();
            let mae = smartcore::metrics::mean_absolute_error(&actual, &predicted);
            let r2 = smartcore::metrics::r2(&actual, &predicted);
            vec![
                json!({ "metric": "rmse", "value": rmse }),
                json!({ "metric": "mae", "value": mae }),
                json!({ "metric": "r2", "value": r2 }),
            ]
        } else {
            // Classification: encode both columns through one shared label
            // space so integer-coded metrics line up, then add a confusion
            // matrix as one row per non-empty (actual, predicted) cell.
            let mut labels: Vec<String> = Vec::new();
            let mut encode = |row: &JsonValue, col: &str, labels: &mut Vec<String>| -> usize {
                let raw = label_of(row.get(col));
                match labels.iter().position(|l| l == &raw) {
                    Some(i) => i,
                    None => {
                        labels.push(raw);
                        labels.len() - 1
                    }
                }
            };
            let actual: Vec<i64> = rows
                .iter()
                .map(|r| encode(r, &spec.actual_column, &mut labels) as i64)
                .collect();
            let predicted: Vec<i64> = rows
                .iter()
                .map(|r| encode(r, &spec.predicted_column, &mut labels) as i64)
                .collect();
            let accuracy = smartcore::metrics::accuracy(&actual, &predicted);
            let mut out = vec![json!({ "metric": "accuracy", "value": accuracy })];
            let n = labels.len();
            let mut counts = vec![vec![0usize; n]; n];
            for (a, p) in actual.iter().zip(predicted.iter()) {
                counts[*a as usize][*p as usize] += 1;
            }
            for (ai, arow) in counts.iter().enumerate() {
                for (pi, &c) in arow.iter().enumerate() {
                    if c > 0 {
                        out.push(json!({
                            "metric": "confusion",
                            "actual": labels[ai],
                            "predicted": labels[pi],
                            "count": c,
                        }));
                    }
                }
            }
            out
        };

        let count = metrics.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &metrics)?;
        Ok(format!(
            "ml.score ({}): {} metric row(s) -> {}",
            spec.task, count, spec.node_id
        ))
    }

    /// Load a model bundle previously written by run_ml_learner.
    fn load_model(&self, db: &Path, model_node_id: &str) -> Result<Model, EngineError> {
        let rows = self.run_rows(
            Some(db),
            &format!(
                "SELECT {} FROM {} LIMIT 1;",
                plan::quote_ident(MODEL_COLUMN),
                plan::quote_ident(model_node_id)
            ),
        )?;
        let encoded = rows
            .first()
            .and_then(|r| r.get(MODEL_COLUMN))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                EngineError::Query(format!(
                    "ml.predict: no trained model found at '{}' (did the Learner run?)",
                    model_node_id
                ))
            })?;
        let bytes = B64
            .decode(encoded)
            .map_err(|e| EngineError::Query(format!("ml: decode model: {}", e)))?;
        bincode::deserialize(&bytes)
            .map_err(|e| EngineError::Query(format!("ml: deserialize model: {}", e)))
    }
}

// === Deep Learning (ONNX) ========================================
//
// Gated behind the `onnx` feature, which links the ONNX Runtime native
// library. The reader records the model path in a one-row table (same model
// table convention as classic ML); the predictor loads the session and runs
// inference. When the feature is compiled out, both nodes return a clear
// "rebuild with --features onnx" error instead of silently doing nothing.

#[cfg(feature = "onnx")]
impl DuckdbEngine {
    /// dl.onnx.reader: validate the model path exists, then store it as a
    /// one-row table keyed by this node id for a downstream ONNX Predictor.
    pub(crate) fn run_onnx_reader(
        &self,
        db: &Path,
        spec: &plan::OnnxReaderSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        if !Path::new(&spec.path).exists() {
            return Err(EngineError::Config(format!(
                "dl.onnx.reader: model file not found: {}",
                spec.path
            )));
        }
        let row = json!({ MODEL_COLUMN: spec.path });
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &[row])?;
        Ok(format!("dl.onnx.reader: {} -> {}", spec.path, spec.node_id))
    }

    /// dl.onnx.predict: run the ONNX model from the upstream reader over the
    /// named feature columns, appending the first output as a column.
    pub(crate) fn run_onnx_predict(
        &self,
        db: &Path,
        spec: &plan::OnnxPredictSpec,
    ) -> Result<String, EngineError> {
        use ort::session::Session;
        use ort::value::Value;

        self.check_cancelled()?;
        // The reader stored the model path in __quilt_model.
        let path_rows = self.run_rows(
            Some(db),
            &format!(
                "SELECT {} FROM {} LIMIT 1;",
                plan::quote_ident(MODEL_COLUMN),
                plan::quote_ident(&spec.model_node_id)
            ),
        )?;
        let model_path = path_rows
            .first()
            .and_then(|r| r.get(MODEL_COLUMN))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                EngineError::Query(format!(
                    "dl.onnx.predict: no model at '{}' (did the ONNX Reader run?)",
                    spec.model_node_id
                ))
            })?
            .to_string();

        let mut rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &[])?;
            return Ok(format!("dl.onnx.predict: 0 rows -> {}", spec.node_id));
        }

        let session = Session::builder()
            .and_then(|b| b.commit_from_file(&model_path))
            .map_err(|e| EngineError::Query(format!("onnx: load model: {}", e)))?;

        let n_rows = rows.len();
        let n_cols = spec.feature_columns.len();
        // Flatten features row-major into an [n_rows, n_cols] f32 tensor.
        let mut flat: Vec<f32> = Vec::with_capacity(n_rows * n_cols);
        for row in &rows {
            for c in &spec.feature_columns {
                flat.push(cell_to_f64(row.get(c)) as f32);
            }
        }
        let input = Value::from_array(([n_rows, n_cols], flat))
            .map_err(|e| EngineError::Query(format!("onnx: build input tensor: {}", e)))?;

        // Feed the model's first input by name.
        let input_name = session
            .inputs
            .first()
            .map(|i| i.name.clone())
            .ok_or_else(|| EngineError::Query("onnx: model declares no inputs".into()))?;
        let outputs = session
            .run(ort::inputs![input_name => input])
            .map_err(|e| EngineError::Query(format!("onnx: inference failed: {}", e)))?;

        // Take the first output, flatten to f32, and slice one prediction per row.
        let first_out = session
            .outputs
            .first()
            .map(|o| o.name.clone())
            .ok_or_else(|| EngineError::Query("onnx: model declares no outputs".into()))?;
        let (shape, data) = outputs[first_out.as_str()]
            .try_extract_tensor::<f32>()
            .map_err(|e| EngineError::Query(format!("onnx: read output: {}", e)))?;
        let per_row = if shape.len() >= 2 {
            (shape[1..].iter().product::<i64>()).max(1) as usize
        } else {
            1
        };
        for (i, row) in rows.iter_mut().enumerate() {
            if let Some(obj) = row.as_object_mut() {
                let pred: JsonValue = if per_row == 1 {
                    json!(data.get(i).copied().unwrap_or(0.0))
                } else {
                    let start = i * per_row;
                    let slice: Vec<f32> =
                        data[start..(start + per_row).min(data.len())].to_vec();
                    json!(slice)
                };
                obj.insert(spec.output_column.clone(), pred);
            }
        }
        let count = rows.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &rows)?;
        Ok(format!("dl.onnx.predict: {} rows -> {}", count, spec.node_id))
    }
}

// Stubs when the ONNX feature is disabled: surface a clear, actionable error
// rather than failing to compile the dispatch arms in lib.rs.
#[cfg(not(feature = "onnx"))]
impl DuckdbEngine {
    pub(crate) fn run_onnx_reader(
        &self,
        _db: &Path,
        _spec: &plan::OnnxReaderSpec,
    ) -> Result<String, EngineError> {
        Err(EngineError::Config(
            "dl.onnx.reader: this build has no ONNX support. Rebuild quilt-duckdb-engine with --features onnx.".into(),
        ))
    }

    pub(crate) fn run_onnx_predict(
        &self,
        _db: &Path,
        _spec: &plan::OnnxPredictSpec,
    ) -> Result<String, EngineError> {
        Err(EngineError::Config(
            "dl.onnx.predict: this build has no ONNX support. Rebuild quilt-duckdb-engine with --features onnx.".into(),
        ))
    }
}
