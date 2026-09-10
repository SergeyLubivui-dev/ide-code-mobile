#!/usr/bin/env bash
# Пересобрать баннер из исходного ролика.
# Прямой проход склеивается с обратным, ускоренным в 2,4 раза, — маятник
# зашит в сам файл, странице остаётся только loop.
set -euo pipefail

SRC="${1:?укажите исходный mp4}"
OUT="$(dirname "$0")/../assets"
FILTER="[0:v]scale=900:-2,fps=22,split[a][b];[b]reverse,setpts=0.42*PTS[r];[a][r]concat=n=2:v=1:a=0[v]"

ffmpeg -y -i "$SRC" -filter_complex "$FILTER" -map "[v]" -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 30 -preset slow \
  -movflags +faststart "$OUT/ide-code-banner.mp4"

ffmpeg -y -i "$SRC" -filter_complex "$FILTER" -map "[v]" -an \
  -c:v libvpx-vp9 -b:v 0 -crf 43 -row-mt 1 -deadline good -cpu-used 4 \
  "$OUT/ide-code-banner.webm"

ffmpeg -y -i "$OUT/ide-code-banner.mp4" -vf "select=eq(n\,10),scale=600:-2" \
  -vframes 1 -q:v 6 "$OUT/ide-code-banner-poster.jpg"

python3 "$(dirname "$0")/embed-banner.py"
