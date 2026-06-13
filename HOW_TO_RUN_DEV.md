# HOW TO RUN (Dev)

Menjalankan Quilt dalam mode development (Vite + Tauri shell sekaligus).

## Prasyarat (sekali saja)
- Rust toolchain (lihat `rust-toolchain.toml`)
- Node.js + npm
- Tauri CLI:
  ```bash
  cargo install tauri-cli
  ```

## Langkah

### 1. Install dependency frontend
```bash
cd frontend
npm install
```

### 2. Jalankan app (dari folder apps/desktop)
```bash
cd ../apps/desktop
cargo tauri dev
```

`cargo tauri dev` otomatis menyalakan Vite dev server (`npm run dev`) lalu membuka window desktop yang menunjuk ke `http://localhost:5173`.

> Jangan pakai `cargo run -p quilt-desktop` sendirian — itu cuma menjalankan shell Rust tanpa Vite, window-nya akan "localhost refused to connect".

## Opsional: build paket rilis (offline, terbundel)
```bash
cd apps/desktop
cargo tauri build
```
Output installer + exe ada di `apps/desktop/target/release/bundle/`.

## Catatan ML/DL
- Node classic ML (`ml.*`) aktif di build default — tidak perlu langkah tambahan.
- Node Deep Learning (`dl.onnx.*`) butuh build dengan feature `onnx`:
  ```bash
  cargo tauri dev --features quilt-duckdb-engine/onnx
  ```
  dan `libonnxruntime` harus tersedia di sistem (on-demand installer belum ada — lihat PLANNING_ML_DL.md).
