#!/usr/bin/env bash
# make-icons.sh — generate semua ukuran icon dari 1 master PNG (macOS, no deps)
# Pakai: ./make-icons.sh master.png Quilt
set -euo pipefail

SRC="${1:?Usage: ./make-icons.sh <master.png> [name]}"
NAME="${2:-Quilt}"
OUT="${NAME}.iconset"

[ -f "$SRC" ] || { echo "File tidak ada: $SRC"; exit 1; }

# Cek master minimal 1024
W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
[ "$W" -ge 1024 ] || echo "⚠️  master cuma ${W}px — disarankan >=1024 utk @2x tajam"

rm -rf "$OUT" && mkdir -p "$OUT"

# macOS .icns iconset (10 file)
declare -a SET=(
  "16:icon_16x16"      "32:icon_16x16@2x"
  "32:icon_32x32"      "64:icon_32x32@2x"
  "128:icon_128x128"   "256:icon_128x128@2x"
  "256:icon_256x256"   "512:icon_256x256@2x"
  "512:icon_512x512"   "1024:icon_512x512@2x"
)
for e in "${SET[@]}"; do
  px="${e%%:*}"; fn="${e##*:}"
  sips -z "$px" "$px" "$SRC" --out "$OUT/$fn.png" >/dev/null
done
iconutil -c icns "$OUT" -o "$NAME.icns"
echo "✅ $NAME.icns  +  $OUT/ (10 ukuran)"

# Bonus: ukuran umum lain (web/favicon/store) → folder export/
mkdir -p export
for px in 16 32 48 64 128 256 512 1024; do
  sips -z "$px" "$px" "$SRC" --out "export/${NAME}-${px}.png" >/dev/null
done
echo "✅ export/ (8 PNG: 16..1024)"
