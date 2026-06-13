#!/usr/bin/env bash
# Edit Quack+LOC60.mp4 with marketing overlays.
# Source: ~30 s screen recording delivered by the user.
# Output: same resolution (1920x1080), no crop, with intro card,
# lower-third feature banners cycling through Localization / Quack /
# In-app Git, and an outro card.
#
# Run from this dir so drawtext can reference fonts by bare filename
# (avoids the colon-in-path escape mess on Windows).

set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(cd ../.. && pwd)"
SRC="C:/Users/Sourav Roy/Downloads/Quack+LOC60.mp4"
OUT="C:/Users/Sourav Roy/Downloads/Quack+LOC60-marketed.mp4"
LOGO="$ROOT/apps/desktop/icons/icon-source.png"
TMP="C:/Users/SOURAV~1/AppData/Local/Temp/quilt-vid"
mkdir -p "$TMP"

W=1920
H=1080
FPS=30
SR=48000
TEXT="0xecf0f7"
MUTED="0xaab3c5"
ACCENT="0x18d4e0"
BG="#07090f"

FF="ffmpeg -y -hide_banner -loglevel error"

# ---- INTRO (3s)
$FF -f lavfi -i "color=c=${BG}:s=${W}x${H}:r=${FPS}:d=3" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=${SR}" \
    -loop 1 -t 3 -i "$LOGO" \
    -filter_complex "
      [2:v]scale=320:320[lg];
      [0:v][lg]overlay=(W-w)/2:(H-h)/2-120,
      drawtext=fontfile=font-bold.ttf:text='Quilt v0.1.0':fontcolor=${TEXT}:fontsize=88:x=(w-tw)/2:y=h/2+150,
      drawtext=fontfile=font-reg.ttf:text='What is new':fontcolor=${MUTED}:fontsize=38:x=(w-tw)/2:y=h/2+260,
      fade=t=in:st=0:d=0.4,fade=t=out:st=2.5:d=0.5[v]
    " -map "[v]" -map 1:a -t 3 -shortest \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
    -c:a aac -b:a 128k -ar ${SR} -ac 2 "$TMP/intro.mp4"

# ---- BODY: source + lower-third banners + small persistent watermark
# Banner order matches what the screen actually shows:
#   0.0 - 11.0 s   Quack demo (longest)
#  11.0 - 14.0 s   Git panel (brief shot - user's "Git for a second")
#  14.0 - 30.4 s   60-language switching (long tail)
# Banner is a single dark strip at the bottom; the three feature pairs
# (title + tagline) take turns inside it via drawtext enable= guards.
$FF -i "$SRC" \
    -filter_complex "
      [0:v]drawbox=y=ih-110:color=0x000000@0.72:width=iw:height=110:t=fill:enable='between(t,0.4,30.4)',
      drawtext=fontfile=font-bold.ttf:text='DuckDB Quack remote protocol':fontcolor=${TEXT}:fontsize=44:x=70:y=h-90:enable='between(t,0.4,11.0)',
      drawtext=fontfile=font-reg.ttf:text='Multi-writer remote DuckDB. May 2026 spec.':fontcolor=${MUTED}:fontsize=26:x=70:y=h-42:enable='between(t,0.4,11.0)',
      drawtext=fontfile=font-bold.ttf:text='In-app Git':fontcolor=${TEXT}:fontsize=44:x=70:y=h-90:enable='between(t,11.0,14.0)',
      drawtext=fontfile=font-reg.ttf:text='Commit, push, pull. GitHub plus GitLab.':fontcolor=${MUTED}:fontsize=26:x=70:y=h-42:enable='between(t,11.0,14.0)',
      drawtext=fontfile=font-bold.ttf:text='60 UI languages':fontcolor=${TEXT}:fontsize=44:x=70:y=h-90:enable='between(t,14.0,30.4)',
      drawtext=fontfile=font-reg.ttf:text='Arabic. Mandarin. Hindi. Right-to-left ready.':fontcolor=${MUTED}:fontsize=26:x=70:y=h-42:enable='between(t,14.0,30.4)',
      drawtext=fontfile=font-bold.ttf:text='Quilt':fontcolor=${ACCENT}:fontsize=22:x=w-tw-30:y=30
    " -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
    -c:a aac -b:a 128k -ar ${SR} -ac 2 "$TMP/body.mp4"

# ---- OUTRO (4s)
$FF -f lavfi -i "color=c=${BG}:s=${W}x${H}:r=${FPS}:d=4" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=${SR}" \
    -loop 1 -t 4 -i "$LOGO" \
    -filter_complex "
      [2:v]scale=260:260[lg];
      [0:v][lg]overlay=(W-w)/2:(H-h)/2-200,
      drawtext=fontfile=font-bold.ttf:text='Quilt':fontcolor=${TEXT}:fontsize=80:x=(w-tw)/2:y=h/2+90,
      drawtext=fontfile=font-reg.ttf:text='Free  /  Open source  /  Local-first':fontcolor=${MUTED}:fontsize=32:x=(w-tw)/2:y=h/2+200,
      drawtext=fontfile=font-bold.ttf:text='github.com/dwickyfp/Quilt':fontcolor=${ACCENT}:fontsize=40:x=(w-tw)/2:y=h/2+280,
      fade=t=in:st=0:d=0.4,fade=t=out:st=3.5:d=0.5[v]
    " -map "[v]" -map 1:a -t 4 -shortest \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
    -c:a aac -b:a 128k -ar ${SR} -ac 2 "$TMP/outro.mp4"

# ---- Concat (re-encode to guarantee aligned codec params)
cat > "$TMP/concat.txt" <<EOF
file 'intro.mp4'
file 'body.mp4'
file 'outro.mp4'
EOF

$FF -f concat -safe 0 -i "$TMP/concat.txt" \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
    -c:a aac -b:a 128k -ar ${SR} -ac 2 \
    "$OUT"

echo "Done: $OUT"
ls -lh "$OUT"
ffprobe -v error -show_entries format=duration -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1 "$OUT"
