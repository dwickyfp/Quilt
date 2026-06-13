# PLANNING_ML_DL.md — Integrasi Node Machine Learning & Deep Learning (Quilt)

> Status hidup. Diperbarui tiap ada progress. Trace terakhir: 2026-06-13.

## Tujuan

Menambah node ML & DL ala **KNIME** ke Quilt: alur *Partition → Learner → Predictor → Scorer* dengan **model port** (edge biru yang mengalirkan model dari Learner ke Predictor), plus inference Deep Learning via ONNX.

## Keputusan arsitektur (terkonfirmasi)

- **Hybrid runtime**: classic ML native Rust (`smartcore`), DL via ONNX Runtime Rust (`ort`) — keduanya Rust-native, tetap "single binary, no Python".
- **DL = inference ONNX** model terlatih (bukan training network).
- **Model flow**: tipe edge baru `model`. Tidak ikut `is_data_edge`, tapi ikut `topological_sort` agar Learner terjadwal sebelum Predictor. Map `model_inputs` menghubungkan Predictor → Learner sumbernya.
- **`ort` di-gate** di feature flag `onnx` (off by default; native lib di-install on-demand).
- **Penyimpanan model**: Learner menulis model (bincode→base64) sebagai tabel 1-baris bernama node-id-nya; Predictor membacanya kembali via `run_rows`. (Reuse helper materialize/run_rows yang ada — tak perlu file artifact terpisah.)

## Pola tiap node (3 tempat)
1. Katalog: `frontend/src/workflow-ui/palette-data.ts`
2. Form config: `frontend/src/workflow-ui/fields/manifest-synth.ts`
3. Builder props→spec: `build_stage` di `crates/duckdb-engine/src/plan/mod.rs`
4. (Node runtime) Eksekusi: `crates/duckdb-engine/src/ml.rs` + dispatch di `lib.rs`

## Node yang direncanakan
| Component | Eksekusi | Status |
|---|---|---|
| `ml.partition` | SQL murni, dual output train/test | spec + SQL builder DONE |
| `ml.learner.{linreg,logreg,tree,forest,knn,kmeans}` | RuntimeSpec → ml.rs | spec DONE, eksekusi BELUM |
| `ml.predict` | RuntimeSpec → ml.rs | spec DONE, eksekusi BELUM |
| `ml.score` | RuntimeSpec → ml.rs | spec DONE, eksekusi BELUM |
| `dl.onnx.reader` | RuntimeSpec → ml.rs (feature onnx) | spec DONE, eksekusi BELUM |
| `dl.onnx.predict` | RuntimeSpec → ml.rs (feature onnx) | spec DONE, eksekusi BELUM |

---

## ✅ SUDAH SELESAI

### Fondasi model port (engine + frontend)
- [x] `is_model_edge` helper — `crates/duckdb-engine/src/plan/graph.rs`
- [x] `compile()` menyatukan data+model edge utk topological sort + bangun `model_inputs` — `plan/mod.rs`
- [x] `build_stage` terima `model_input: Option<&str>` + diteruskan dari call site
- [x] `output_table_ref` memetakan port `test` → `<node>__test` — `graph.rs`
- [x] Tipe edge `'model'` (group `model`, warna accent) — `frontend/src/canvas/connection-types.ts`
- [x] Auto-deteksi tipe edge dari port (sudah ada di Canvas.tsx, tak perlu diubah)

### Frontend katalog & form
- [x] `NodeKind` `'ml'` + helper `ml()` + kategori "Machine Learning" & "Deep Learning" (11 node) — `palette-data.ts`
- [x] Port ML/DL di `portsForComponent` (MODEL_IN/OUT, partition dual output) — `manifest-synth.ts`
- [x] `synthMl()` + dispatch — form fields tiap node ML/DL — `manifest-synth.ts`
- [x] `base()` meneruskan kind `ml`
- [x] Warna `--kind-ml`, `.node-ml`, KIND_LABEL/KIND_COLOR — `styles.css`, `PropertiesPanel.tsx`
- [x] **Frontend lint hijau** (`npm run lint` exit 0)

### Engine wiring (spec/plan)
- [x] Dependency: `smartcore` 0.3.2, `bincode` 1.3, `rand`, `ort` 2.0-rc (feature `onnx`), `ndarray` — `Cargo.toml`
- [x] **`cargo fetch` resolve OK** (Cargo.lock terupdate)
- [x] 5 varian `RuntimeSpec` (MlLearner/MlPredict/MlScore/OnnxReader/OnnxPredict) — `plan/mod.rs`
- [x] 5 struct spec — `plan/specs.rs`
- [x] Deklarasi mut + `.or_else` chain di build_stage
- [x] Branch `build_stage`: `ml.partition` (SQL dual-output train/test, random + stratified), `ml.learner.*`, `ml.predict`, `ml.score`, `dl.onnx.reader`, `dl.onnx.predict`
- [x] **Engine crate build OK** sebelum penambahan ml.rs (`cargo build -p quilt-duckdb-engine` exit 0)

---

## ⏳ BELUM SELESAI

### 1. Implementasi eksekusi ML — `crates/duckdb-engine/src/ml.rs` (file kosong, BLOCKER utama)
- [ ] `mod ml;` di `lib.rs`
- [ ] Helper baca tabel → matrix fitur `Vec<Vec<f64>>` + target (numeric encode utk klasifikasi)
- [ ] `run_ml_learner`: match algorithm → fit smartcore → serialize (bincode+base64) → simpan tabel model 1-baris
  - linreg (LinearRegression), logreg (LogisticRegression), tree (DecisionTreeClassifier), forest (RandomForestClassifier), knn (KNNClassifier+Euclidian), kmeans (KMeans)
- [ ] `run_ml_predict`: load model dari `model_node_id` → predict → append `output_column` → materialize
- [ ] `run_ml_score`: hitung accuracy/precision/recall + confusion (classification) atau RMSE/MAE/R² (regression) → emit tabel metrik
- [ ] Dispatch 3 arm (`RuntimeSpec::MlLearner/MlPredict/MlScore`) di loop `execute_pipeline_with_events` — `lib.rs`

### 2. Implementasi ONNX DL (feature `onnx`)
- [ ] `run_onnx_reader`: simpan path model (validasi file ada) — non-feature: error jelas "install ONNX runtime"
- [ ] `run_onnx_predict`: load ONNX via `ort`, susun input tensor dari feature columns, jalankan, append output
- [ ] Dispatch 2 arm (OnnxReader/OnnxPredict) — `lib.rs` (cfg feature)
- [ ] On-demand install ONNX runtime — `apps/desktop/src/engine_manager.rs` (ikut pola dbt/DuckDB)

### 3. Frontend polish
- [ ] i18n label `node.ml` + label kategori — `frontend/src/i18n/locales`
- [ ] Update Duckie `SYSTEM_PROMPT` agar tahu komponen ml.*/dl.* — `apps/desktop/src/ai_chat.rs`

### 4. Verifikasi
- [ ] Unit test engine: pipeline CSV → partition → learner.tree → predict → score, assert metrik deterministik (seed) — pola `plan/tests.rs` / `tests/execution.rs`
- [ ] Test ordering: model edge → Learner sebelum Predictor di `compile()`
- [ ] `cargo test -p quilt-duckdb-engine` + `cargo build` workspace
- [ ] End-to-end manual: jalankan app, rangkai pipeline ML dari palette, Run, cek tabel metrik Scorer di Output panel

---

## Catatan teknis ml.rs (referensi API smartcore 0.3.2)
- `DenseMatrix::from_2d_vec(&Vec<Vec<f64>>)` → `Self` (panik jika kosong → guard dulu)
- fit: `Model::fit(&x, &y, Params::default().with_*(..))` → `Result<Model, Failed>` (inherent fn, tanpa import trait)
- predict: `model.predict(&x)` → `Result<Vec<TY>, Failed>`
- semua model derive `Serialize/Deserialize` di bawah feature `serde` (aktif)
- klasifikasi: target di-encode ke integer label (map string→idx), simpan mapping dalam model bundle utk decode saat predict
- KNN butuh `Euclidian::<f64>::new()` sebagai distance default
- metrics: `smartcore::metrics::{accuracy, mean_squared_error, r2, precision, recall}` (free fn)
