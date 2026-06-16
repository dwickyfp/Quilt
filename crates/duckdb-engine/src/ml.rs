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
use smartcore::cluster::dbscan::{DBSCAN, DBSCANParameters};
use smartcore::ensemble::random_forest_classifier::{
    RandomForestClassifier, RandomForestClassifierParameters,
};
use smartcore::decomposition::pca::{PCA, PCAParameters};
use smartcore::linalg::basic::arrays::Array;
use smartcore::linalg::basic::matrix::DenseMatrix;
use smartcore::linear::linear_regression::{LinearRegression, LinearRegressionParameters};
use smartcore::linear::logistic_regression::{LogisticRegression, LogisticRegressionParameters};
use smartcore::linear::ridge_regression::{RidgeRegression, RidgeRegressionParameters};
use smartcore::linear::lasso::{Lasso, LassoParameters};
use smartcore::linear::elastic_net::{ElasticNet, ElasticNetParameters};
use smartcore::naive_bayes::gaussian::{GaussianNB, GaussianNBParameters};
use smartcore::metrics::distance::euclidian::Euclidian;
use smartcore::neighbors::knn_classifier::{KNNClassifier, KNNClassifierParameters};
use smartcore::neighbors::knn_regressor::{KNNRegressor, KNNRegressorParameters};
use smartcore::tree::decision_tree_classifier::{
    DecisionTreeClassifier, DecisionTreeClassifierParameters,
};
use smartcore::ensemble::random_forest_regressor::{
    RandomForestRegressor, RandomForestRegressorParameters,
};
use smartcore::tree::decision_tree_regressor::{
    DecisionTreeRegressor, DecisionTreeRegressorParameters,};
use smartcore::svm::svc::{SVC, SVCParameters};
use smartcore::svm::svr::{SVR, SVRParameters};
use smartcore::svm::Kernels;

// Gradient-boosted decision trees (pure-Rust, no FFI). gbdt::ValueType is f32.
use gbdt::config::Config as GbdtConfig;
use gbdt::decision_tree::{Data as GbdtData, DataVec as GbdtDataVec};
use gbdt::gradient_boost::GBDT;

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
    TreeReg {
        features: Vec<String>,
        model: DecisionTreeRegressor<f64, f64, Matrix, Vec<f64>>,
    },
    ForestReg {
        features: Vec<String>,
        model: RandomForestRegressor<f64, f64, Matrix, Vec<f64>>,
    },
    KnnReg {
        features: Vec<String>,
        model: KNNRegressor<f64, f64, Matrix, Vec<f64>, Euclidian<f64>>,
    },
    Ridge {
        features: Vec<String>,
        model: RidgeRegression<f64, f64, Matrix, Vec<f64>>,
    },
    Lasso {
        features: Vec<String>,
        model: Lasso<f64, f64, Matrix, Vec<f64>>,
    },
    ElasticNet {
        features: Vec<String>,
        model: ElasticNet<f64, f64, Matrix, Vec<f64>>,
    },
    Dbscan {
        features: Vec<String>,
        model: DBSCAN<f64, i64, Matrix, Vec<i64>, Euclidian<f64>>,
    },
    GaussianNb {
        features: Vec<String>,
        labels: Vec<String>,
        model: GaussianNB<f64, u64, Matrix, Vec<u64>>,
    },
    /// Gradient-boosted trees, binary classification. labels[0] = negative
    /// class (-1), labels[1] = positive class (+1). predict returns P(+1).
    Xgb {
        features: Vec<String>,
        labels: Vec<String>,
        model: GBDT,
    },
    /// Gradient-boosted trees, regression.
    XgbReg {
        features: Vec<String>,
        model: GBDT,
    },
    /// Support Vector Classifier with owned model (no borrowed lifetime).
    Svc {
        features: Vec<String>,
        labels: Vec<String>,
        support_vectors: Vec<Vec<f64>>,
        sv_labels: Vec<i64>,
        weights: Vec<f64>,
        bias: f64,
        kernel_type: String,
        kernel_gamma: f64,
    },
    /// Support Vector Regressor with owned model (no borrowed lifetime).
    Svr {
        features: Vec<String>,
        support_vectors: Vec<Vec<f64>>,
        weights: Vec<f64>,
        bias: f64,
        kernel_type: String,
        kernel_gamma: f64,
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
            | Model::KMeans { features, .. }
            | Model::TreeReg { features, .. }
            | Model::ForestReg { features, .. }
            | Model::KnnReg { features, .. }
            | Model::Ridge { features, .. }
            | Model::Lasso { features, .. }
            | Model::ElasticNet { features, .. }
            | Model::Dbscan { features, .. }
            | Model::GaussianNb { features, .. }
            | Model::Xgb { features, .. }
            | Model::XgbReg { features, .. }
            | Model::Svc { features, .. }
            | Model::Svr { features, .. } => features,
        }
    }

    fn algorithm_name(&self) -> &'static str {
        match self {
            Model::LinReg { .. } => "linreg",
            Model::LogReg { .. } => "logreg",
            Model::Tree { .. } => "tree",
            Model::Forest { .. } => "forest",
            Model::Knn { .. } => "knn",
            Model::KMeans { .. } => "kmeans",
            Model::TreeReg { .. } => "tree.reg",
            Model::ForestReg { .. } => "forest.reg",
            Model::KnnReg { .. } => "knn.reg",
            Model::Ridge { .. } => "ridge",
            Model::Lasso { .. } => "lasso",
            Model::ElasticNet { .. } => "elasticnet",
            Model::Dbscan { .. } => "dbscan",
            Model::GaussianNb { .. } => "nb.gaussian",
            Model::Xgb { .. } => "xgb",
            Model::XgbReg { .. } => "xgb.reg",
            Model::Svc { .. } => "svc",
            Model::Svr { .. } => "svr",
        }
    }

    /// Serialize the model to a portable, self-describing JSON document other
    /// platforms can read - the smartcore params (coefficients/tree/centroids)
    /// plus the feature list and class labels, under a versioned header.
    fn to_export_json(&self) -> Result<String, EngineError> {
        let inner = serde_json::to_value(self)
            .map_err(|e| EngineError::Query(format!("ml: serialize model to json: {}", e)))?;
        let doc = json!({
            "format": "quilt-ml-model/v1",
            "framework": "smartcore",
            "algorithm": self.algorithm_name(),
            "features": self.features(),
            "model": inner,
        });
        serde_json::to_string_pretty(&doc)
            .map_err(|e| EngineError::Query(format!("ml: encode model json: {}", e)))
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

/// Build a gbdt training DataVec: feature vec (f32) + label. gbdt's ValueType
/// is f32, so all values are cast down. `label_fn` maps a row to its target
/// (e.g. -1.0/+1.0 for binary classification, or the raw numeric for
/// regression).
fn build_gbdt_data<F>(rows: &[JsonValue], features: &[String], mut label_fn: F) -> GbdtDataVec
where
    F: FnMut(&JsonValue) -> f32,
{
    rows.iter()
        .map(|row| {
            let feat: Vec<f32> = features
                .iter()
                .map(|c| cell_to_f64(row.get(c)) as f32)
                .collect();
            GbdtData::new_training_data(feat, 1.0, label_fn(row), None)
        })
        .collect()
}

/// Build a gbdt test DataVec (no labels) for prediction.
fn build_gbdt_test(rows: &[JsonValue], features: &[String]) -> GbdtDataVec {
    rows.iter()
        .map(|row| {
            let feat: Vec<f32> = features
                .iter()
                .map(|c| cell_to_f64(row.get(c)) as f32)
                .collect();
            GbdtData::new_test_data(feat, None)
        })
        .collect()
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

/// Apply SVM kernel function (used for owned-model predict since smartcore's
/// SVC/SVR parameters are #[serde(skip)] and can't round-trip via bincode).
fn svm_kernel_apply(kernel_type: &str, gamma: f64, x_i: &[f64], x_j: &[f64]) -> f64 {
    match kernel_type {
        "linear" => x_i.iter().zip(x_j.iter()).map(|(a, b)| a * b).sum::<f64>(),
        // RBF: exp(-gamma * ||x_i - x_j||^2)
        _ => {
            let sq_dist: f64 = x_i.iter().zip(x_j.iter())
                .map(|(a, b)| (a - b) * (a - b))
                .sum();
            (-gamma * sq_dist).exp()
        }
    }
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
            "tree.reg" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = DecisionTreeRegressorParameters::default()
                    .with_max_depth(spec.max_depth.max(1) as u16);
                let m = DecisionTreeRegressor::fit(&x, &y, params).map_err(fit_failed)?;
                Model::TreeReg { features, model: m }
            }
            "forest.reg" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = RandomForestRegressorParameters::default()
                    .with_n_trees(spec.n_trees.max(1))
                    .with_max_depth(spec.max_depth.max(1) as u16);
                let m = RandomForestRegressor::fit(&x, &y, params).map_err(fit_failed)?;
                Model::ForestReg { features, model: m }
            }
            "knn.reg" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = KNNRegressorParameters::default().with_k(spec.k.max(1));
                let m = KNNRegressor::fit(&x, &y, params).map_err(fit_failed)?;
                Model::KnnReg { features, model: m }
            }
            "ridge" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = RidgeRegressionParameters::default().with_alpha(spec.alpha);
                let m = RidgeRegression::fit(&x, &y, params).map_err(fit_failed)?;
                Model::Ridge { features, model: m }
            }
            "lasso" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = LassoParameters::default().with_alpha(spec.alpha);
                let m = Lasso::fit(&x, &y, params).map_err(fit_failed)?;
                Model::Lasso { features, model: m }
            }
            "elasticnet" => {
                let y: Vec<f64> = rows
                    .iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let params = ElasticNetParameters::default()
                    .with_alpha(spec.alpha)
                    .with_l1_ratio(spec.l1_ratio);
                let m = ElasticNet::fit(&x, &y, params).map_err(fit_failed)?;
                Model::ElasticNet { features, model: m }
            }
            "dbscan" => {
                let params = DBSCANParameters::default()
                    .with_eps(spec.eps)
                    .with_min_samples(spec.min_samples.max(1));
                let m = DBSCAN::fit(&x, params).map_err(fit_failed)?;
                Model::Dbscan { features, model: m }
            }
            "nb.gaussian" => {
                let (y_i64, labels) = encode_labels(&rows, &spec.target_column);
                let y: Vec<u64> = y_i64.iter().map(|&v| v as u64).collect();
                let m =
                    GaussianNB::fit(&x, &y, GaussianNBParameters::default()).map_err(fit_failed)?;
                Model::GaussianNb {
                    features,
                    labels,
                    model: m,
                }
            }
            "xgb" => {
                // Binary classification. gbdt LogLikelyhood wants labels -1/+1
                // and predict returns P(+1). Encode the target to two classes;
                // labels[0] -> -1 (negative), labels[1] -> +1 (positive).
                let (encoded, labels) = encode_labels(&rows, &spec.target_column);
                if labels.len() != 2 {
                    return Err(EngineError::Config(format!(
                        "ml.learner.xgb: binary classification needs exactly 2 classes, found {}",
                        labels.len()
                    )));
                }
                let mut cfg = GbdtConfig::new();
                cfg.set_feature_size(features.len());
                cfg.set_max_depth(spec.max_depth.max(1) as u32);
                cfg.set_iterations(spec.n_trees.max(1));
                cfg.set_shrinkage(spec.learning_rate as f32);
                cfg.set_loss("LogLikelyhood");
                cfg.set_training_optimization_level(0);
                // class index 1 -> +1.0, class index 0 -> -1.0
                let idx_by_row: Vec<i64> = encoded;
                let mut i = 0usize;
                let mut train = build_gbdt_data(&rows, &features, |_| {
                    let lbl = if idx_by_row[i] == 1 { 1.0f32 } else { -1.0f32 };
                    i += 1;
                    lbl
                });
                let mut m = GBDT::new(&cfg);
                m.fit(&mut train);
                Model::Xgb {
                    features,
                    labels,
                    model: m,
                }
            }
            "xgb.reg" => {
                let mut cfg = GbdtConfig::new();
                cfg.set_feature_size(features.len());
                cfg.set_max_depth(spec.max_depth.max(1) as u32);
                cfg.set_iterations(spec.n_trees.max(1));
                cfg.set_shrinkage(spec.learning_rate as f32);
                cfg.set_loss("SquaredError");
                cfg.set_training_optimization_level(0);
                let mut train = build_gbdt_data(&rows, &features, |row| {
                    cell_to_f64(row.get(&spec.target_column)) as f32
                });
                let mut m = GBDT::new(&cfg);
                m.fit(&mut train);
                Model::XgbReg { features, model: m }
            }
            "svc" => {
                // Binary classification. smartcore SVC requires labels -1/+1.
                let (encoded, labels) = encode_labels(&rows, &spec.target_column);
                if labels.len() != 2 {
                    return Err(EngineError::Config(format!(
                        "ml.learner.svc: binary classification needs exactly 2 classes, found {}",
                        labels.len()
                    )));
                }
                // Map encoded 0/1 → -1/+1
                let y: Vec<i64> = encoded.iter().map(|&v| if v == 0 { -1 } else { 1 }).collect();
                let gamma = if spec.gamma > 0.0 { spec.gamma } else { 1.0 / features.len() as f64 };
                let params = match spec.kernel.as_str() {
                    "linear" => SVCParameters::default().with_c(spec.c).with_kernel(Kernels::linear()),
                    _ => SVCParameters::default().with_c(spec.c).with_kernel(Kernels::rbf().with_gamma(gamma)),
                };
                let svc = SVC::fit(&x, &y, &params).map_err(fit_failed)?;
                // Serialize trained model to JSON, then deserialize to concrete type.
                // After round-trip, parameters is None (#[serde.skip]), but
                // instances/w/b are owned and survive.
                let svc_json = serde_json::to_string(&svc)
                    .map_err(|e| EngineError::Query(format!("svc json: {}", e)))?;
                let svc_val: serde_json::Value = serde_json::from_str(&svc_json)
                    .map_err(|e| EngineError::Query(format!("svc parse: {}", e)))?;
                // Extract fields from JSON Value
                let sv: Vec<Vec<f64>> = svc_val.get("instances")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let w_vec: Vec<f64> = svc_val.get("w")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let b_val: f64 = svc_val.get("b")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                // Recover per-SV labels from training data.
                // smartcore's w[] = raw alpha (not alpha*y). For the correct decision
                // function f(x) = b + Σ(α_i · y_i · K(sv_i, x)), we need y_i.
                // Match each SV back to training data to recover its label.
                let mut sv_labels: Vec<i64> = Vec::with_capacity(sv.len());
                let n_train = x.shape().0;
                for sv_row in &sv {
                    let mut best_label: i64 = 1;
                    let mut min_dist = f64::INFINITY;
                    for ti in 0..n_train {
                        let mut dist: f64 = 0.0;
                        let mut exact = true;
                        for (fi, svv) in sv_row.iter().enumerate() {
                            let tv: f64 = *x.get((ti, fi));
                            let diff = tv - svv;
                            if diff.abs() >= 1e-10 { exact = false; }
                            dist += diff * diff;
                        }
                        if exact { best_label = y[ti]; break; }
                        if dist < min_dist { min_dist = dist; best_label = y[ti]; }
                    }
                    sv_labels.push(best_label);
                }
                Model::Svc {
                    features,
                    labels,
                    support_vectors: sv,
                    sv_labels,
                    weights: w_vec,
                    bias: b_val,
                    kernel_type: spec.kernel.clone(),
                    kernel_gamma: gamma,
                }
            }
            "svr" => {
                let y: Vec<f64> = rows.iter()
                    .map(|r| cell_to_f64(r.get(&spec.target_column)))
                    .collect();
                let gamma = if spec.gamma > 0.0 { spec.gamma } else { 1.0 / features.len() as f64 };
                let params = match spec.kernel.as_str() {
                    "linear" => SVRParameters::default().with_eps(spec.epsilon).with_c(spec.c).with_kernel(Kernels::linear()),
                    _ => SVRParameters::default().with_eps(spec.epsilon).with_c(spec.c).with_kernel(Kernels::rbf().with_gamma(gamma)),
                };
                let svr = SVR::fit(&x, &y, &params).map_err(fit_failed)?;
                let svr_json = serde_json::to_string(&svr)
                    .map_err(|e| EngineError::Query(format!("svr json: {}", e)))?;
                // Extract fields from JSON Value to avoid accessing private
                // struct fields on smartcore::svm::svr::SVR.
                let svr_val: serde_json::Value = serde_json::from_str(&svr_json)
                    .map_err(|e| EngineError::Query(format!("svr roundtrip: {}", e)))?;
                let sv: Vec<Vec<f64>> = svr_val.get("instances")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let w_vec: Vec<f64> = svr_val.get("w")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let b_val: f64 = svr_val.get("b")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                Model::Svr {
                    features,
                    support_vectors: sv,
                    weights: w_vec,
                    bias: b_val,
                    kernel_type: spec.kernel.clone(),
                    kernel_gamma: gamma,
                }
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
            Model::TreeReg { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::ForestReg { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::KnnReg { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::Ridge { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::Lasso { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::ElasticNet { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|v| json!(v))
                .collect(),
            Model::Dbscan { model, .. } => model
                .predict(&x)
                .map_err(fit_failed)?
                .into_iter()
                .map(|c| json!(c))
                .collect(),
            Model::GaussianNb { model, labels, .. } => {
                let preds_u64 = model.predict(&x).map_err(fit_failed)?;
                let preds_i64: Vec<i64> = preds_u64.iter().map(|&v| v as i64).collect();
                decode_class_preds(preds_i64, labels)
            }
            Model::Xgb { model, labels, .. } => {
                // gbdt predict returns P(+1); threshold at 0.5 -> class index,
                // then decode to the original label string.
                let test = build_gbdt_test(&rows, &features);
                let probs = model.predict(&test);
                let preds_i64: Vec<i64> = probs
                    .iter()
                    .map(|&p| if p > 0.5 { 1 } else { 0 })
                    .collect();
                decode_class_preds(preds_i64, labels)
            }
            Model::XgbReg { model, .. } => {
                let test = build_gbdt_test(&rows, &features);
                model
                    .predict(&test)
                    .into_iter()
                    .map(|v| json!(v))
                    .collect()
            }
            Model::Svc { support_vectors, weights, bias, labels, kernel_type, kernel_gamma, .. } => {
                // smartcore's w[] already includes y_i (sign-baked alpha).
                // Decision function: f(x) = b + sum(w[i] * K(sv[i], x))
                let n_sv = support_vectors.len();
                rows.iter().map(|row| {
                    let xi: Vec<f64> = features.iter()
                        .map(|f| cell_to_f64(row.get(f)))
                        .collect();
                    let mut f = *bias;
                    for i in 0..n_sv {
                        let k = svm_kernel_apply(kernel_type, *kernel_gamma, &xi, &support_vectors[i]);
                        f += weights[i] * k;
                    }
                    let cls_idx: usize = if f > 0.0 { 1 } else { 0 };
                    json!(labels.get(cls_idx).cloned().unwrap_or_else(|| cls_idx.to_string()))
                }).collect()
            }
            Model::Svr { support_vectors, weights, bias, kernel_type, kernel_gamma, .. } => {
                let n_sv = support_vectors.len();
                rows.iter().map(|row| {
                    let xi: Vec<f64> = features.iter()
                        .map(|f| cell_to_f64(row.get(f)))
                        .collect();
                    let mut f = *bias;
                    for i in 0..n_sv {
                        let k = svm_kernel_apply(kernel_type, *kernel_gamma, &xi, &support_vectors[i]);
                        f += weights[i] * k;
                    }
                    json!(f)
                }).collect()
            }
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
            let encode = |row: &JsonValue, col: &str, labels: &mut Vec<String>| -> usize {
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

    /// Run k-fold CV for one feature subset and return the per-fold
    /// (score, test_row_count). Shared by ml.crossval and ml.featureselect so
    /// both exercise the identical, already-verified learner/predictor paths.
    /// `node_id` only names the transient per-fold temp tables.
    #[allow(clippy::too_many_arguments)]
    fn cv_fold_scores(
        &self,
        db: &Path,
        node_id: &str,
        rows: &[JsonValue],
        algorithm: &str,
        target_column: &str,
        feature_columns: &[String],
        max_depth: usize,
        n_trees: usize,
        k: usize,
        max_iter: usize,
        alpha: f64,
        l1_ratio: f64,
        learning_rate: f64,
        folds: usize,
        seed: u64,
        regression: bool,
    ) -> Result<Vec<(f64, usize)>, EngineError> {
        use std::hash::{Hash, Hasher};
        let folds = folds.max(2);

        // Deterministic fold assignment: hash(seed, row index) % folds. Stable
        // for a given (seed, row order) so runs are reproducible.
        let assign: Vec<usize> = (0..rows.len())
            .map(|i| {
                let mut h = std::collections::hash_map::DefaultHasher::new();
                seed.hash(&mut h);
                (i as u64).hash(&mut h);
                (h.finish() % folds as u64) as usize
            })
            .collect();

        let train_tbl = format!("{}__cv_train", node_id);
        let test_tbl = format!("{}__cv_test", node_id);
        let model_tbl = format!("{}__cv_model", node_id);
        let pred_tbl = format!("{}__cv_pred", node_id);

        let mut out: Vec<(f64, usize)> = Vec::with_capacity(folds);

        for fold in 0..folds {
            self.check_cancelled()?;
            let train: Vec<JsonValue> = rows
                .iter()
                .zip(assign.iter())
                .filter(|(_, &f)| f != fold)
                .map(|(r, _)| r.clone())
                .collect();
            let test: Vec<JsonValue> = rows
                .iter()
                .zip(assign.iter())
                .filter(|(_, &f)| f == fold)
                .map(|(r, _)| r.clone())
                .collect();
            if train.is_empty() || test.is_empty() {
                continue;
            }

            // Materialize this fold's train/test as temp tables the existing
            // learner/predictor methods can SELECT from.
            materialize_jsonobjects_as_table(&self.bin, db, &train_tbl, &train)?;
            materialize_jsonobjects_as_table(&self.bin, db, &test_tbl, &test)?;

            // 1) Train on the train table -> model table (verified path).
            let learner_spec = plan::MlLearnerSpec {
                node_id: model_tbl.clone(),
                from_view: train_tbl.clone(),
                algorithm: algorithm.to_string(),
                target_column: target_column.to_string(),
                feature_columns: feature_columns.to_vec(),
                max_depth,
                n_trees,
                k,
                max_iter,
                alpha,
                l1_ratio,
                eps: 0.5,
                min_samples: 5,
                learning_rate,
                kernel: "rbf".into(),
                c: 1.0,
                epsilon: 0.1,
                gamma: 0.0,
            };
            self.run_ml_learner(db, &learner_spec)?;

            // 2) Predict on the held-out test table.
            let predict_spec = plan::MlPredictSpec {
                node_id: pred_tbl.clone(),
                from_view: test_tbl.clone(),
                model_node_id: model_tbl.clone(),
                output_column: "__cv_pred".into(),
            };
            self.run_ml_predict(db, &predict_spec)?;

            // 3) Score: read predictions back and compute the fold metric.
            let scored = self.run_rows(
                Some(db),
                &format!("SELECT * FROM {};", plan::quote_ident(&pred_tbl)),
            )?;
            let score = if regression {
                let actual: Vec<f64> = scored
                    .iter()
                    .map(|r| cell_to_f64(r.get(target_column)))
                    .collect();
                let predicted: Vec<f64> = scored
                    .iter()
                    .map(|r| cell_to_f64(r.get("__cv_pred")))
                    .collect();
                smartcore::metrics::mean_squared_error(&actual, &predicted).sqrt()
            } else {
                // Encode actual+predicted through one shared label space.
                let mut labels: Vec<String> = Vec::new();
                let enc = |raw: String, labels: &mut Vec<String>| -> i64 {
                    match labels.iter().position(|l| l == &raw) {
                        Some(i) => i as i64,
                        None => {
                            labels.push(raw);
                            (labels.len() - 1) as i64
                        }
                    }
                };
                let actual: Vec<i64> = scored
                    .iter()
                    .map(|r| enc(label_of(r.get(target_column)), &mut labels))
                    .collect();
                let predicted: Vec<i64> = scored
                    .iter()
                    .map(|r| enc(label_of(r.get("__cv_pred")), &mut labels))
                    .collect();
                smartcore::metrics::accuracy(&actual, &predicted)
            };
            out.push((score, test.len()));
        }

        // Best-effort cleanup of the per-fold temp tables.
        for t in [&train_tbl, &test_tbl, &model_tbl, &pred_tbl] {
            let _ = self.run(
                Some(db),
                &format!("DROP TABLE IF EXISTS {};", plan::quote_ident(t)),
                false,
            );
        }
        Ok(out)
    }

    /// ml.crossval: automated k-fold cross-validation. Trains the chosen
    /// learner `folds` times — each time holding out one fold for testing — by
    /// reusing the existing run_ml_learner / run_ml_predict code paths on
    /// per-fold temp tables. Emits a metrics table: one score row per fold plus
    /// a mean row (with std). No new model logic — the 12 learners are exercised
    /// through their already-verified paths.
    pub(crate) fn run_ml_crossval(
        &self,
        db: &Path,
        spec: &plan::MlCrossvalSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.crossval: no rows from {}",
                spec.from_view
            )));
        }
        let folds = spec.folds.max(2);
        if rows.len() < folds {
            return Err(EngineError::Config(format!(
                "ml.crossval: need at least {} rows for {} folds, got {}",
                folds,
                folds,
                rows.len()
            )));
        }

        let regression = spec.task == "regression";
        let metric_name = if regression { "rmse" } else { "accuracy" };

        let fold_results = self.cv_fold_scores(
            db,
            &spec.node_id,
            &rows,
            &spec.algorithm,
            &spec.target_column,
            &spec.feature_columns,
            spec.max_depth,
            spec.n_trees,
            spec.k,
            spec.max_iter,
            spec.alpha,
            spec.l1_ratio,
            spec.learning_rate,
            folds,
            spec.seed,
            regression,
        )?;

        if fold_results.is_empty() {
            return Err(EngineError::Query(
                "ml.crossval: no fold produced a score".into(),
            ));
        }
        let mut metrics: Vec<JsonValue> = Vec::new();
        for (fold, (score, test_rows)) in fold_results.iter().enumerate() {
            metrics.push(json!({
                "fold": fold,
                "metric": metric_name,
                "value": score,
                "test_rows": test_rows,
            }));
        }
        let fold_scores: Vec<f64> = fold_results.iter().map(|(s, _)| *s).collect();
        let nfolds = fold_scores.len();
        let mean = fold_scores.iter().sum::<f64>() / nfolds as f64;
        let var = fold_scores.iter().map(|s| (s - mean).powi(2)).sum::<f64>() / nfolds as f64;
        metrics.push(json!({
            "fold": "mean",
            "metric": metric_name,
            "value": mean,
            "std": var.sqrt(),
        }));

        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &metrics)?;
        Ok(format!(
            "ml.crossval ({}, {}): {} folds, mean {}={:.4} -> {}",
            spec.algorithm, spec.task, nfolds, metric_name, mean, spec.node_id
        ))
    }

    /// ml.featureselect: greedy forward feature selection driven by k-fold CV.
    /// Starting from no features, repeatedly adds the candidate that most
    /// improves the mean CV score (accuracy up / RMSE down), stopping when no
    /// candidate improves it or the optional cap is reached. Emits a table of
    /// the selection path: step, added feature, running feature set, cv score.
    /// Reuses cv_fold_scores so the 12 learners run through verified paths.
    pub(crate) fn run_ml_featureselect(
        &self,
        db: &Path,
        spec: &plan::MlFeatureSelectSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.featureselect: no rows from {}",
                spec.from_view
            )));
        }
        let folds = spec.folds.max(2);
        if rows.len() < folds {
            return Err(EngineError::Config(format!(
                "ml.featureselect: need at least {} rows for {} folds, got {}",
                folds,
                folds,
                rows.len()
            )));
        }

        // Candidate pool: explicit list, or every column except the target.
        let mut candidates: Vec<String> = if spec.feature_columns.is_empty() {
            rows.first()
                .and_then(|r| r.as_object())
                .map(|o| {
                    o.keys()
                        .filter(|c| *c != &spec.target_column)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default()
        } else {
            spec.feature_columns.clone()
        };
        if candidates.is_empty() {
            return Err(EngineError::Config(
                "ml.featureselect: no candidate feature columns".into(),
            ));
        }
        let regression = spec.task == "regression";
        let metric_name = if regression { "rmse" } else { "accuracy" };
        // Lower is better for RMSE; higher is better for accuracy.
        let better = |a: f64, b: f64| if regression { a < b } else { a > b };

        let max_features = if spec.max_features == 0 {
            candidates.len()
        } else {
            spec.max_features.min(candidates.len())
        };

        let mean_cv = |me: &Self, feats: &[String]| -> Result<f64, EngineError> {
            let r = me.cv_fold_scores(
                db,
                &spec.node_id,
                &rows,
                &spec.algorithm,
                &spec.target_column,
                feats,
                spec.max_depth,
                spec.n_trees,
                spec.k,
                spec.max_iter,
                spec.alpha,
                spec.l1_ratio,
                spec.learning_rate,
                folds,
                spec.seed,
                regression,
            )?;
            if r.is_empty() {
                return Ok(if regression { f64::INFINITY } else { 0.0 });
            }
            Ok(r.iter().map(|(s, _)| *s).sum::<f64>() / r.len() as f64)
        };

        let mut selected: Vec<String> = Vec::new();
        let mut steps: Vec<JsonValue> = Vec::new();
        let mut best_so_far = if regression { f64::INFINITY } else { f64::NEG_INFINITY };

        while selected.len() < max_features && !candidates.is_empty() {
            self.check_cancelled()?;
            let mut best_cand: Option<(usize, f64)> = None;
            for (i, cand) in candidates.iter().enumerate() {
                let mut trial = selected.clone();
                trial.push(cand.clone());
                let score = mean_cv(self, &trial)?;
                let take = match best_cand {
                    None => true,
                    Some((_, bs)) => better(score, bs),
                };
                if take {
                    best_cand = Some((i, score));
                }
            }
            let (idx, score) = match best_cand {
                Some(v) => v,
                None => break,
            };
            // Stop if the best candidate doesn't improve the running score.
            if !better(score, best_so_far) {
                break;
            }
            best_so_far = score;
            let added = candidates.remove(idx);
            selected.push(added.clone());
            steps.push(json!({
                "step": selected.len(),
                "added_feature": added,
                "features": selected.join(","),
                "n_features": selected.len(),
                "metric": metric_name,
                "cv_score": score,
            }));
        }

        if steps.is_empty() {
            return Err(EngineError::Query(
                "ml.featureselect: no feature improved the score".into(),
            ));
        }
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &steps)?;
        Ok(format!(
            "ml.featureselect ({}, {}): selected {} of {} features -> {}",
            spec.algorithm,
            spec.task,
            selected.len(),
            selected.len() + candidates.len(),
            spec.node_id
        ))
    }

    /// ml.pca: principal component analysis. A single fit+transform node — fits
    /// PCA on the chosen numeric feature columns and appends the reduced
    /// components as new columns (pc1..pcN). Unlike the learners this needs no
    /// model round-trip / predict contract: it fits and transforms the same
    /// rows in one pass, so the runtime-dependent column count (N components)
    /// is just N extra keys appended to each output JSON row.
    pub(crate) fn run_ml_pca(
        &self,
        db: &Path,
        spec: &plan::MlPcaSpec,
    ) -> Result<String, EngineError> {
        use smartcore::linalg::basic::arrays::Array;
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.pca: no rows from {}",
                spec.from_view
            )));
        }

        // Feature pool: explicit list, or every numeric column in the first row.
        let features: Vec<String> = if spec.feature_columns.is_empty() {
            rows.first()
                .and_then(|r| r.as_object())
                .map(|o| {
                    o.iter()
                        .filter(|(_, v)| v.is_number())
                        .map(|(k, _)| k.clone())
                        .collect()
                })
                .unwrap_or_default()
        } else {
            spec.feature_columns.clone()
        };
        if features.len() < 2 {
            return Err(EngineError::Config(format!(
                "ml.pca: need at least 2 numeric feature columns, got {}",
                features.len()
            )));
        }
        // smartcore requires n_components <= number of attributes.
        let n_components = spec.n_components.min(features.len()).max(1);

        let x = build_matrix(&rows, &features);
        let pca = PCA::fit(
            &x,
            PCAParameters::default()
                .with_n_components(n_components)
                .with_use_correlation_matrix(spec.use_correlation_matrix),
        )
        .map_err(fit_failed)?;
        let transformed = pca.transform(&x).map_err(fit_failed)?;
        let (nrows, ncomp) = transformed.shape();

        // Append pc1..pcN to each row, optionally dropping the source features.
        let mut out: Vec<JsonValue> = Vec::with_capacity(rows.len());
        for (r, row) in rows.iter().enumerate().take(nrows) {
            let mut obj = match row.as_object() {
                Some(o) => o.clone(),
                None => serde_json::Map::new(),
            };
            if spec.drop_features {
                for f in &features {
                    obj.remove(f);
                }
            }
            for c in 0..ncomp {
                let key = format!("{}{}", spec.output_prefix, c + 1);
                obj.insert(key, json!(*transformed.get((r, c))));
            }
            out.push(JsonValue::Object(obj));
        }

        let count = out.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &out)?;
        Ok(format!(
            "ml.pca: {} rows, {} features -> {} components ({}1..{}{}) -> {}",
            count,
            features.len(),
            ncomp,
            spec.output_prefix,
            spec.output_prefix,
            ncomp,
            spec.node_id
        ))
    }

    /// ml.onehot: one-hot encode categorical columns. A single transform node —
    /// for each source column it appends one 0/1 indicator column per distinct
    /// value (<col>_<value>). With max_categories > 0, only the most frequent N
    /// values get their own column and the rest fold into <col>_other. Same
    /// multi-output shape as ml.pca: no model round-trip, the runtime-dependent
    /// column count is just extra keys on each output row.
    pub(crate) fn run_ml_onehot(
        &self,
        db: &Path,
        spec: &plan::MlOneHotSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "ml.onehot: no rows from {}",
                spec.from_view
            )));
        }

        // For each column, work out the category set (first-seen order) and the
        // frequency of each value, then decide which values keep their own
        // indicator vs. fold into "<col>_other".
        let mut kept: Vec<(String, Vec<String>, bool)> = Vec::new(); // (col, kept_values, has_other)
        for col in &spec.columns {
            let mut order: Vec<String> = Vec::new();
            let mut counts: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for row in &rows {
                let v = label_of(row.get(col));
                if v.is_empty() {
                    continue;
                }
                if !counts.contains_key(&v) {
                    order.push(v.clone());
                }
                *counts.entry(v).or_insert(0) += 1;
            }
            let (keep, has_other) = if spec.max_categories > 0 && order.len() > spec.max_categories {
                // Rank by frequency (desc), then first-seen order for ties.
                let mut ranked = order.clone();
                ranked.sort_by(|a, b| {
                    counts[b]
                        .cmp(&counts[a])
                        .then_with(|| {
                            order.iter().position(|x| x == a).cmp(&order.iter().position(|x| x == b))
                        })
                });
                ranked.truncate(spec.max_categories);
                // Restore first-seen order among the kept values for stable columns.
                let keep: Vec<String> =
                    order.iter().filter(|v| ranked.contains(v)).cloned().collect();
                (keep, true)
            } else {
                (order, false)
            };
            kept.push((col.clone(), keep, has_other));
        }

        // Emit one indicator column per kept value (+ optional _other), appended
        // in column/value order so the output schema is deterministic.
        let mut out: Vec<JsonValue> = Vec::with_capacity(rows.len());
        let mut added_cols = 0usize;
        for row in &rows {
            let mut obj = match row.as_object() {
                Some(o) => o.clone(),
                None => serde_json::Map::new(),
            };
            for (col, values, has_other) in &kept {
                let cell = label_of(row.get(col));
                for v in values {
                    let key = format!("{}_{}", col, v);
                    obj.insert(key, json!(if &cell == v { 1 } else { 0 }));
                }
                if *has_other {
                    let is_other = !cell.is_empty() && !values.contains(&cell);
                    obj.insert(format!("{}_other", col), json!(if is_other { 1 } else { 0 }));
                }
                if spec.drop_original {
                    obj.remove(col);
                }
            }
            out.push(JsonValue::Object(obj));
        }
        for (_, values, has_other) in &kept {
            added_cols += values.len() + usize::from(*has_other);
        }

        let count = out.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &out)?;
        Ok(format!(
            "ml.onehot: {} rows, {} column(s) -> {} indicator column(s) -> {}",
            count,
            spec.columns.len(),
            added_cols,
            spec.node_id
        ))
    }

    /// xf.stat.test: run a hypothesis test over the upstream rows and emit a
    /// small (metric, value) table. Mirrors run_ml_score's shape; the actual
    /// statistics + p-values live in the dependency-free `crate::stats` module.
    pub(crate) fn run_stat_test(
        &self,
        db: &Path,
        spec: &plan::StatTestSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!("SELECT * FROM {};", plan::quote_ident(&spec.from_view)),
        )?;
        if rows.is_empty() {
            return Err(EngineError::Query(format!(
                "xf.stat.test: no rows from {}",
                spec.from_view
            )));
        }

        let bad = |m: &str| EngineError::Config(format!("xf.stat.test ({}): {}", spec.test, m));

        let metrics: Vec<JsonValue> = match spec.test.as_str() {
            "ttest" => {
                if spec.value_column.is_empty() || spec.group_column.is_empty() {
                    return Err(bad("valueColumn and groupColumn are required"));
                }
                // Partition the value column by the (exactly two) group labels.
                let mut keys: Vec<String> = Vec::new();
                let mut samples: Vec<Vec<f64>> = Vec::new();
                for r in &rows {
                    let g = label_of(r.get(&spec.group_column));
                    let idx = match keys.iter().position(|k| k == &g) {
                        Some(i) => i,
                        None => {
                            keys.push(g);
                            samples.push(Vec::new());
                            keys.len() - 1
                        }
                    };
                    samples[idx].push(cell_to_f64(r.get(&spec.value_column)));
                }
                if samples.len() != 2 {
                    return Err(bad("groupColumn must have exactly 2 distinct values"));
                }
                let (t, df, p) = crate::stats::ttest_ind(&samples[0], &samples[1])
                    .ok_or_else(|| bad("each group needs >= 2 values with non-zero variance"))?;
                vec![
                    json!({ "metric": "t", "value": t }),
                    json!({ "metric": "df", "value": df }),
                    json!({ "metric": "p_value", "value": p }),
                    json!({ "metric": "group_a", "value": keys[0] }),
                    json!({ "metric": "group_b", "value": keys[1] }),
                ]
            }
            "anova" => {
                if spec.value_column.is_empty() || spec.group_column.is_empty() {
                    return Err(bad("valueColumn and groupColumn are required"));
                }
                let mut keys: Vec<String> = Vec::new();
                let mut groups: Vec<Vec<f64>> = Vec::new();
                for r in &rows {
                    let g = label_of(r.get(&spec.group_column));
                    let idx = match keys.iter().position(|k| k == &g) {
                        Some(i) => i,
                        None => {
                            keys.push(g);
                            groups.push(Vec::new());
                            keys.len() - 1
                        }
                    };
                    groups[idx].push(cell_to_f64(r.get(&spec.value_column)));
                }
                let (f, df_b, df_w, p) = crate::stats::anova_oneway(&groups)
                    .ok_or_else(|| bad("need >= 2 groups and more rows than groups"))?;
                vec![
                    json!({ "metric": "F", "value": f }),
                    json!({ "metric": "df_between", "value": df_b }),
                    json!({ "metric": "df_within", "value": df_w }),
                    json!({ "metric": "p_value", "value": p }),
                    json!({ "metric": "groups", "value": keys.len() as f64 }),
                ]
            }
            "chi2" => {
                if spec.group_column.is_empty() || spec.column_column.is_empty() {
                    return Err(bad("groupColumn (row factor) and columnColumn are required"));
                }
                // Build an R x C contingency table of raw counts.
                let mut row_keys: Vec<String> = Vec::new();
                let mut col_keys: Vec<String> = Vec::new();
                let mut table: Vec<Vec<f64>> = Vec::new();
                for r in &rows {
                    let rk = label_of(r.get(&spec.group_column));
                    let ck = label_of(r.get(&spec.column_column));
                    let ri = match row_keys.iter().position(|k| k == &rk) {
                        Some(i) => i,
                        None => {
                            row_keys.push(rk);
                            table.push(vec![0.0; col_keys.len()]);
                            row_keys.len() - 1
                        }
                    };
                    let ci = match col_keys.iter().position(|k| k == &ck) {
                        Some(i) => i,
                        None => {
                            col_keys.push(ck);
                            for trow in table.iter_mut() {
                                trow.push(0.0);
                            }
                            col_keys.len() - 1
                        }
                    };
                    table[ri][ci] += 1.0;
                }
                let (chi2, df, p) = crate::stats::chi2_independence(&table)
                    .ok_or_else(|| bad("need a >= 2x2 contingency table with a non-zero total"))?;
                vec![
                    json!({ "metric": "chi2", "value": chi2 }),
                    json!({ "metric": "df", "value": df }),
                    json!({ "metric": "p_value", "value": p }),
                    json!({ "metric": "rows", "value": row_keys.len() as f64 }),
                    json!({ "metric": "cols", "value": col_keys.len() as f64 }),
                ]
            }
            other => {
                return Err(bad(&format!(
                    "unknown test '{}' (expected ttest | anova | chi2)",
                    other
                )));
            }
        };

        let count = metrics.len();
        materialize_jsonobjects_as_table(&self.bin, db, &spec.node_id, &metrics)?;
        Ok(format!(
            "xf.stat.test ({}): {} metric row(s) -> {}",
            spec.test, count, spec.node_id
        ))
    }

    /// ml.model.writer: export the upstream model artifact to a file for use
    /// on other platforms. Auto-detects the artifact type stored in the model
    /// node's __quilt_model cell: a base64-bincode classic-ML bundle is decoded
    /// and re-emitted as portable JSON; anything else is treated as an ONNX
    /// file path and copied verbatim.
    pub(crate) fn run_model_writer(
        &self,
        db: &Path,
        spec: &plan::ModelWriterSpec,
    ) -> Result<String, EngineError> {
        self.check_cancelled()?;
        let rows = self.run_rows(
            Some(db),
            &format!(
                "SELECT {} FROM {} LIMIT 1;",
                plan::quote_ident(MODEL_COLUMN),
                plan::quote_ident(&spec.model_node_id)
            ),
        )?;
        let cell = rows
            .first()
            .and_then(|r| r.get(MODEL_COLUMN))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                EngineError::Query(format!(
                    "ml.model.writer: no model at '{}' (did the upstream Learner/Reader run?)",
                    spec.model_node_id
                ))
            })?;

        // Classic ML: base64 -> bincode -> Model -> portable JSON.
        if let Ok(bytes) = B64.decode(cell) {
            if let Ok(model) = bincode::deserialize::<Model>(&bytes) {
                let json = model.to_export_json()?;
                std::fs::write(&spec.path, json).map_err(|e| {
                    EngineError::Query(format!("ml.model.writer: write {}: {}", spec.path, e))
                })?;
                return Ok(format!(
                    "ml.model.writer: exported {} model -> {}",
                    model.algorithm_name(),
                    spec.path
                ));
            }
        }

        // DL: the cell holds an ONNX file path; copy it as-is.
        if Path::new(cell).is_file() {
            std::fs::copy(cell, &spec.path).map_err(|e| {
                EngineError::Query(format!(
                    "ml.model.writer: copy ONNX model {} -> {}: {}",
                    cell, spec.path, e
                ))
            })?;
            return Ok(format!("ml.model.writer: copied ONNX model -> {}", spec.path));
        }

        Err(EngineError::Query(format!(
            "ml.model.writer: unrecognized model artifact at '{}' (not a classic-ML bundle, and not an existing ONNX file path)",
            spec.model_node_id
        )))
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
