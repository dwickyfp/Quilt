# Research: Text Mining & Association Rules for Quilt Engine

**Date:** 2026-06-17
**Goal:** Determine which text mining and association rule features to build in Rust vs DuckDB SQL vs skip.

---

## 1. Summary of Recommendations

| Feature             | Recommendation       | Approach                           | Effort |
|---------------------|----------------------|------------------------------------|--------|
| **Tokenization**    | ✅ Build in DuckDB SQL | `regexp_split_to_table()` + stopword anti-join | 1–2 days |
| **TF-IDF**          | ✅ Build in DuckDB SQL | CTE pipeline (proven pattern)      | 2–3 days |
| **Stemming**        | ✅ Build in DuckDB SQL | `fts` extension `stem()` function  | 0.5 day |
| **Sentiment (Lexical)** | ✅ Build in Rust  | `vader-sentimental` crate          | 3–4 days |
| **NER (Rule-based)**| ⏸️ Phase 2 in Rust   | `scivex-nlp` or `scirs2-text`     | 5–7 days |
| **NER (ML-based)**  | 🚫 Skip for now       | Requires model download/weights    | — |
| **Apriori**         | ✅ Build in Rust       | `rust-rule-miner` or custom impl   | 4–5 days |
| **FP-Growth**       | ✅ Build in Rust       | `rust-rule-miner` crate            | 4–5 days |
| **Language Detection** | ✅ Build in Rust   | `whatlang` crate (trivial)         | 1 day  |

---

## 2. Existing Rust Crates

### 2a. Text Mining Crates

| Crate | Version | Downloads | Pure Rust | What It Provides |
|-------|---------|-----------|-----------|------------------|
| **`scirs2-text`** | 0.5.0 | — | ✅ Yes | Comprehensive NLP: tokenization, TF-IDF, NER (rule/dict/CRF), sentiment (VADER-style), LDA topic modeling, BPE, Word2Vec. The "kitchen sink." |
| **`scivex-nlp`** | — | — | ✅ Yes | Similar to scirs2-text: tokenizers, TF-IDF, Porter stemmer, rule-based NER, lexicon sentiment, HMM POS tagging, LDA. |
| **`keyword_extraction`** | 1.5.0 | — | ✅ Yes | Focused: TF-IDF, RAKE, TextRank, YAKE keyword extraction. |
| **`tf-idf-vectorizer`** | 0.4.2 | — | ✅ Yes | TF-IDF with cosine similarity search. Generic over numeric types. |
| **`vader-sentimental`** | 0.1.3 | 5.7K | ✅ Yes | VADER sentiment analysis (negation, intensity, emoji). 1.5–10x faster than Python. |
| **`whatlang`** | 0.18.0 | — | ✅ Yes | Language detection for 70 languages via trigrams. Very lightweight. |
| **`rust-stemmers`** | 1.2 | 133 ⭐ | ✅ Yes | Snowball stemming for 18 languages. Well-established. |
| **`tokenizers`** (HuggingFace) | 0.23.1 | 19M+ | ✅ Yes (core is Rust) | BPE, WordPiece, Unigram tokenizers. Can load pretrained from HuggingFace Hub. |
| **`textprep`** | 0.1.5 | — | ✅ Yes | Normalization, tokenization, FlashText keyword matching, n-grams. |
| **`anno`** | 0.10.0 | — | Partial | 17 NER backends (BERT ONNX, GLiNER, CRF, HMM, pattern). Heavy; needs model weights. |

**Key finding:** `scirs2-text` is the most comprehensive pure-Rust text NLP crate available. It covers tokenization, TF-IDF, sentiment, NER, topic modeling, and more — all in pure safe Rust with SIMD acceleration.

### 2b. Association Rule Crates

| Crate | Version | Algorithms | Notes |
|-------|---------|------------|-------|
| **`rust-rule-miner`** | 0.2.2 | Apriori, FP-Growth, Sequential Patterns | Full-featured: confidence/support/lift/conviction metrics, CSV/Excel loading, GRL export, Graphviz. **Most mature option.** |
| **`apriori-rs`** (remykarem) | — | Apriori only | Minimal, with Python bindings. Clean but basic. |
| **`apriori_pattern_miner`** | 0.1.1 | Apriori only | Uses rayon for parallelism. 50% documented. |

**Key finding:** `rust-rule-miner` is the only crate with both Apriori AND FP-Growth plus quality metrics. It's the clear choice.

---

## 3. What DuckDB SQL Can Already Do

DuckDB has surprising text capabilities natively:

### Tokenization ✅ in SQL
```sql
-- Split text into words
SELECT doc_id, UNNEST(regexp_split_to_table(LOWER(text), '\\W+')) AS token
FROM documents;

-- Remove stopwords via anti-join
SELECT t.*
FROM tokenized t
ANTI JOIN stopwords s ON t.token = s.word;
```

### TF-IDF ✅ in SQL (proven pattern)
```sql
WITH tokenized AS (
    SELECT doc_id, UNNEST(regexp_split_to_table(LOWER(text), '[^a-z0-9]+')) AS token
    FROM documents
    WHERE token != ''
),
tf AS (
    SELECT doc_id, token, COUNT(*)::DOUBLE / SUM(COUNT(*)) OVER (PARTITION BY doc_id) AS tf
    FROM tokenized GROUP BY doc_id, token
),
idf AS (
    SELECT token, LN((SELECT COUNT(DISTINCT doc_id) FROM documents)::DOUBLE / COUNT(DISTINCT doc_id)) AS idf
    FROM tokenized GROUP BY token
)
SELECT tf.doc_id, tf.token, tf.tf * idf.idf AS tfidf
FROM tf JOIN idf USING (token)
ORDER BY tf.doc_id, tfidf DESC;
```

### Stemming ✅ via DuckDB FTS extension
```sql
INSTALL fts; LOAD fts;
SELECT stem('running', 'english');  -- returns 'run'
SELECT stem('feeling', 'porter');   -- returns 'feel'
```
Supported stemmers: Arabic, Danish, Dutch, English, Finnish, French, German, Greek, Hungarian, Italian, Norwegian, Portuguese, Romanian, Russian, Spanish, Swedish, Tamil, Turkish.

### Full-Text Search + BM25 ✅ via FTS extension
```sql
PRAGMA create_fts_index('docs', 'doc_id', 'text', stemmer='english');
SELECT fts_main_docs.match_bm25(doc_id, 'search term') AS score
FROM docs WHERE score IS NOT NULL ORDER BY score DESC;
```

### What DuckDB SQL CANNOT Do
- **Sentiment analysis** — requires a lexicon/model, not expressible in SQL
- **NER** — requires model inference or complex rule matching
- **Apriori/FP-Growth** — iterative algorithm with candidate generation, not expressible as set operations
- **Language detection** — statistical model, not SQL
- **Word embeddings** — requires neural inference (DuckDB VSS stores vectors, doesn't generate them)

---

## 4. What KNIME Does

### KNIME Text Mining Pipeline
1. **String to Document** — wraps text into Document objects
2. **Language Detection** — identifies language per document
3. **Preprocessing** — sentence/word tokenization, stemming, stopword removal, n-gram filtering, POS tagging
4. **TF node** — computes relative term frequency per document
5. **IDF node** — computes inverse document frequency
6. **Frequency Filter** — keeps top-K terms by TF-IDF
7. **Document Vector** — transforms bag-of-words into numeric vectors (boolean or TF-IDF values)
8. **Term Vector** — alternative: term-centric vectors in document space
9. **Keyword Extraction** — TF-IDF, Chi-Square, Keygraph, Co-occurrence
10. **Sentiment** — uses ML classifier on document vectors (not built-in lexicon; workflow-based)

### KNIME Association Rules
1. **Association Rule Learner (Borgelt)** — Apriori implementation (Christian Borgelt's C code)
   - Input: Transaction list (BitVectors or Collections)
   - Config: min_support (absolute), min_confidence, max itemset length
   - Output: Association rules with support/confidence
   - Supports: free/closed/maximal itemsets, ARRAY or TIDList data structure
2. **Association Rule Learner (native)** — built-in implementation
   - Similar config; supports ARRAY or TIDList
3. **Yacaree Associator** — self-tuning association rules (STARK project)

**Key insight:** KNIME's text mining is document-centric with a bag-of-words model. Association rules operate on transaction lists. Both are well-defined data pipelines — exactly what Quilt is good at.

---

## 5. Detailed Recommendations & Architecture

### TIER 1: Build in DuckDB SQL (Low effort, high value)

#### 5a. Tokenization Node (`tm.tokenize`)
- **SQL Approach:** `regexp_split_to_table(LOWER(text), '\\W+')` + UNNEST
- **Config:** Column to tokenize, regex pattern, case normalization, stopword list (built-in or user-supplied table)
- **Rust code:** Minimal — just generates the SQL CTE
- **Effort:** 1–2 days (builder + manifest-synth + palette-data)

#### 5b. TF-IDF Node (`tm.tfidf`)
- **SQL Approach:** Multi-CTE pipeline (tokenize → count TF → count IDF → multiply)
- **Config:** Text column, ID column, optional stopword list, IDF variant (standard/smooth/probabilistic)
- **Rust code:** Generates the multi-CTE SQL
- **Effort:** 2–3 days (must handle edge cases: empty docs, single-doc corpus)

#### 5c. Stemming (`tm.stem` or parameter on tokenize)
- **SQL Approach:** DuckDB FTS extension `stem(word, 'english')`
- **Rust code:** Just calls the extension function in generated SQL
- **Effort:** 0.5 day (but requires enabling the FTS extension at runtime)
- **Risk:** FTS extension is marked experimental

### TIER 2: Build in Rust (Medium effort, high value)

#### 5d. Sentiment Analysis Node (`tm.sentiment`)
- **Crate:** `vader-sentimental` (0.1.3, MIT, pure Rust, lexicon-based)
- **Architecture:** Same pattern as existing ML nodes — Rust function computes sentiment per row
- **Approach:** Register as a DuckDB scalar UDF or run as a runtime step that reads/writes Parquet
- **Output:** compound score, positive/negative/neutral scores, label
- **Effort:** 3–4 days (UDF registration + builder + palette)
- **Why Rust, not SQL:** Sentiment requires a lexicon lookup + rule-based scoring (negation, intensifiers, emoji). Not expressible in SQL.
- **Alternative crate:** `scirs2-text` sentiment module (more features but heavier dependency)

#### 5e. Apriori Node (`tm.apriori`)
- **Crate:** `rust-rule-miner` (Apriori + FP-Growth, quality metrics)
- **Architecture:** Runtime step: read transaction table from DuckDB → mine in Rust → write results back
- **Input:** Transaction table (transaction_id, items as LIST<VARCHAR> or separate rows)
- **Output:** Frequent itemsets + association rules with support/confidence/lift
- **Config:** min_support, min_confidence, min_lift, max_itemset_length
- **Effort:** 4–5 days

#### 5f. FP-Growth Node (`tm.fpgrowth`)
- **Crate:** Same `rust-rule-miner` crate
- **Architecture:** Same as Apriori but uses FP-Growth algorithm
- **Effort:** 1–2 days incremental (same crate, just different algorithm enum)
- **Why Rust, not SQL:** Both algorithms are iterative with tree/candidate structures. SQL can't express this.

#### 5g. Language Detection Node (`tm.langdetect`)
- **Crate:** `whatlang` (0.18.0, MIT, pure Rust, 70 languages, trigram-based)
- **Architecture:** Same UDF pattern as sentiment
- **Output:** language code (ISO 639-3), script, confidence
- **Effort:** 1 day (trivial integration)

### TIER 3: Phase 2 (Higher effort)

#### 5h. NER Node (`tm.ner`)
- **Crate options:**
  - `scivex-nlp` — rule-based NER (regex patterns for PER/ORG/LOC/DATE). Simple but limited.
  - `scirs2-text` — rule-based + dictionary + CRF NER. More comprehensive.
  - `anno` — 17 backends including BERT, GLiNER. Very heavy, needs model weights.
- **Recommendation:** Start with rule-based NER from `scivex-nlp` or `scirs2-text`
  - Detects common entity patterns: emails, URLs, dates, monetary amounts, capitalized phrases
  - No model weights needed
- **Effort:** 5–7 days (rule-based), 15+ days (CRF/ML-based)
- **Why defer:** Rule-based NER is useful but lower priority than sentiment + association rules. ML-based NER requires model weight management.

### TIER 4: Skip

#### 5i. ML-based NER / Transformer Tokenizer
- Requires downloading and managing model weights (ONNX, SafeTensors)
- Adds binary size, compilation complexity, model licensing concerns
- **Recommendation:** Skip for v1. Users can export data to Python for transformer-based NER.

---

## 6. Dependency Impact Analysis

### Minimal Additions (Recommended)
| Crate | Size | Compile Time | New Deps |
|-------|------|-------------|----------|
| `vader-sentimental` | ~50KB | ~10s | 0 (standalone) |
| `whatlang` | ~30KB | ~5s | 0 (standalone) |
| `rust-rule-miner` | ~100KB | ~30s | chrono, serde, hashbrown |

All three are pure Rust with no native/FFI dependencies. They fit the single-binary promise.

### Heavier Options (Phase 2)
| Crate | Size | Compile Time | New Deps |
|-------|------|-------------|----------|
| `scirs2-text` | ~500KB | ~60s+ | ndarray, rayon, num-traits |
| `rust-stemmers` | ~80KB | ~10s | 0 (standalone) |

---

## 7. Implementation Order (Suggested)

1. **`tm.tokenize`** (DuckDB SQL) — 1–2 days. Foundation for everything else.
2. **`tm.tfidf`** (DuckDB SQL) — 2–3 days. Most-requested text mining feature.
3. **`tm.sentiment`** (Rust: vader-sentimental) — 3–4 days. High user value.
4. **`tm.apriori` + `tm.fpgrowth`** (Rust: rust-rule-miner) — 5–6 days. Both from same crate.
5. **`tm.langdetect`** (Rust: whatlang) — 1 day. Quick win.
6. **`tm.ner`** (Rust: scivex-nlp rule-based) — 5–7 days. Phase 2.

**Total for items 1–5: ~15–18 developer-days**

---

## 8. Architecture Notes

### Pattern for DuckDB SQL Nodes (tokenize, tfidf)
These nodes follow the existing pattern: the Rust builder generates a staged DuckDB SQL query with CTEs. No new RuntimeSpec variant needed. Just a new `build_*` function in `builders.rs`.

### Pattern for Rust Runtime Nodes (sentiment, apriori, etc.)
These need a new RuntimeSpec variant or use the existing "run function on materialized table" pattern:
1. Engine materializes input to Parquet
2. Rust function reads Parquet, processes, writes output Parquet
3. Output is loaded back into DuckDB for downstream nodes

This is the same pattern as ML learner/predict — the model/function is bincode-serialized and stored in a DuckDB cell.

### UDF Alternative
For per-row functions (sentiment, language detection), DuckDB's `create_function` API could register Rust functions as SQL UDFs. This would allow:
```sql
SELECT tm_sentiment(text) FROM reviews;
```
However, this requires the engine to register functions at connection time, which may conflict with the staged-SQL compilation model. The materialize-process-reload pattern is safer.
