#!/usr/bin/env bash
#
# convert.sh — prepara un mix per il sito.
#
# Uso:
#   scripts/convert.sh input.wav "Titolo del mix" cover.jpg
#
# Crea (il nome dei file è ricavato dal titolo, es. "Summer Closing" → summer-closing):
#   audio/<id>.mp3              MP3 192 kbps CBR, -14 LUFS, tag ID3 e copertina incorporata
#   data/peaks/<id>.json        picchi della forma d'onda nel formato di wavesurfer.js
#   assets/img/covers/<id>.jpg  copertina per il sito, 600×600
# e stampa durata, dimensione e il blocco da copiare in data/tracks.json.
#
# Variabili facoltative:
#   DATE=2026-09-20   data del mix (default: oggi); l'anno finisce nei tag ID3
#   ID=nome-del-mix   nome dei file generati (default: ricavato dal titolo)
#   FORCE=1           sovrascrive i file già esistenti
#   JSON_OUT=file     scrive anche il blocco per tracks.json in questo file
#
# Requisiti: ffmpeg (con libmp3lame), ffprobe, python3. Nessuna libreria Python extra.
#   Ubuntu: sudo apt install ffmpeg python3
#   Arch:   sudo pacman -S ffmpeg python

set -euo pipefail

# --- Impostazioni --------------------------------------------------------------
ARTIST="Iacopo"
SITE_URL="https://[DOMINIO]/"  # finisce nel commento ID3: sostituisci con il dominio vero
TARGET_I=-14                   # loudness integrata (LUFS)
TARGET_TP=-1                   # true peak massimo (dBTP)
TARGET_LRA=20                  # range ammesso: alto = gain lineare, la dinamica del mix resta intatta
BITRATE=192k
SAMPLE_RATE=44100
COVER_EMBED_MAX=1000           # lato massimo della copertina dentro l'MP3 (px)
COVER_WEB_SIZE=600             # lato della copertina per il sito (px)
PEAKS_POINTS=1600              # punti della forma d'onda
PEAKS_RATE=8000                # frequenza di campionamento usata per calcolare i picchi
# -------------------------------------------------------------------------------

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TOTAL_US=0  # durata dell'ingresso in microsecondi, per la percentuale di avanzamento

die() {
  printf '\nErrore: %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 ||
    die "manca '$1'. Installa con: sudo apt install ffmpeg python3 (Ubuntu) oppure sudo pacman -S ffmpeg python (Arch)"
}

# Legge l'output di "ffmpeg -progress" e mostra la percentuale (solo nel terminale).
progress() {
  local key value pct
  while IFS='=' read -r key value; do
    if [[ -t 1 && $key == out_time_us && $value =~ ^[0-9]+$ ]] && ((TOTAL_US > 0)); then
      pct=$((value * 100 / TOTAL_US))
      ((pct > 100)) && pct=100
      printf '\r      %3d%%' "$pct"
    fi
  done
  if [[ -t 1 ]]; then printf '\r            \r'; fi
  return 0
}

# run_ffmpeg <file di log> <argomenti di ffmpeg...>
run_ffmpeg() {
  local log=$1
  shift
  if ! ffmpeg -hide_banner -nostdin -nostats -progress pipe:1 "$@" 2>"$log" | progress; then
    tail -n 15 "$log" >&2
    die "ffmpeg non è riuscito (dettagli qui sopra)"
  fi
}

# Estrae l'ultimo blocco JSON stampato da loudnorm e restituisce i campi richiesti.
loudnorm_values() {
  python3 -I - "$@" <<'PY'
import json, math, sys

text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
start, end = text.rfind("{"), text.rfind("}")
if start < 0 or end < start:
    sys.exit("loudnorm non ha prodotto misure")
data = json.loads(text[start:end + 1])
values = [data[key] for key in sys.argv[2:]]
for value in values:
    try:
        number = float(value)
    except ValueError:
        continue
    if not math.isfinite(number):
        sys.exit("misura non valida: l'audio sembra silenzioso")
print(*values)
PY
}

# Aggiunge un frame COMM (il campo "commento" dei player) al tag ID3v2.3 scritto da
# ffmpeg, che da solo salverebbe il commento come campo personalizzato TXXX.
add_id3_comment() {
  python3 -I - "$@" <<'PY'
import struct, sys

path, text = sys.argv[1], sys.argv[2]
data = open(path, "rb").read()
if data[:3] != b"ID3" or data[3] != 3 or data[5] != 0:
    sys.exit("tag ID3v2.3 inatteso: commento non aggiunto")
size = data[6] << 21 | data[7] << 14 | data[8] << 7 | data[9]
frames, audio = data[10:10 + size], data[10 + size:]

end = 0  # salta l'eventuale padding finale del tag
while end + 10 <= len(frames) and frames[end:end + 4] != b"\0\0\0\0":
    end += 10 + struct.unpack(">I", frames[end + 4:end + 8])[0]
frames = frames[:end]

try:
    body = b"\x00eng\x00" + text.encode("latin-1")
except UnicodeEncodeError:
    body = b"\x01eng\xff\xfe\x00\x00\xff\xfe" + text.encode("utf-16-le")
frames += b"COMM" + struct.pack(">I", len(body)) + b"\x00\x00" + body

n = len(frames)
header = b"ID3\x03\x00\x00" + bytes([n >> 21 & 0x7F, n >> 14 & 0x7F, n >> 7 & 0x7F, n & 0x7F])
open(path, "wb").write(header + frames + audio)
PY
}

# Calcola i picchi da PCM s16le mono letto su stdin.
# Ogni punto è l'energia RMS di un segmento, normalizzata 0–1: per un mix compresso
# il picco puro è quasi sempre al massimo, l'RMS mostra invece drop e breakdown.
# Il file contiene un array di canali, cioè esattamente ciò che wavesurfer.js
# accetta nell'opzione "peaks" (e che produce con exportPeaks()).
read -r -d '' PEAKS_PY <<'PY' || true
import array, json, math, sys
from operator import mul

points, out_path = int(sys.argv[1]), sys.argv[2]
BLOCK = 64  # campioni per blocco (8 ms a 8 kHz)
energies, counts = [], []
swap = sys.byteorder != "little"
stdin = sys.stdin.buffer
carry = b""

def consume(raw):
    samples = array.array("h", raw)
    if swap:
        samples.byteswap()
    for i in range(0, len(samples), BLOCK):
        block = samples[i:i + BLOCK]
        energies.append(sum(map(mul, block, block)))
        counts.append(len(block))

while True:
    chunk = stdin.read(1 << 20)
    if not chunk:
        break
    chunk = carry + chunk
    usable = len(chunk) - len(chunk) % (2 * BLOCK)
    carry = chunk[usable:]
    consume(chunk[:usable])
if len(carry) >= 2:
    consume(carry[:len(carry) - len(carry) % 2])

if not counts:
    sys.exit("nessun campione audio da analizzare")

n = min(points, len(energies))
peaks = []
for i in range(n):
    a, b = i * len(energies) // n, (i + 1) * len(energies) // n
    peaks.append(math.sqrt(sum(energies[a:b]) / sum(counts[a:b])))
top = max(peaks) or 1.0
with open(out_path, "w", encoding="utf-8") as f:
    json.dump([[round(p / top, 2) for p in peaks]], f, separators=(",", ":"))
    f.write("\n")
PY

# --- Argomenti e controlli -------------------------------------------------------
[[ $# -eq 3 ]] || usage
INPUT=$1
TITLE=$2
COVER=$3

need ffmpeg
need ffprobe
need python3
[[ $(ffmpeg -hide_banner -encoders 2>/dev/null) == *libmp3lame* ]] ||
  die "questo ffmpeg non include l'encoder MP3 (libmp3lame)"

[[ -f $INPUT ]] || die "file audio non trovato: $INPUT"
[[ -f $COVER ]] || die "copertina non trovata: $COVER"
[[ -n ${TITLE//[[:space:]]/} ]] || die "il titolo è vuoto"

DATE=${DATE:-$(date +%F)}
[[ $DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "DATE deve essere nel formato AAAA-MM-GG, es. DATE=2026-09-20"
YEAR=${DATE:0:4}

if [[ -z ${ID:-} ]]; then
  ID=$(python3 -I -c '
import re, sys, unicodedata
text = unicodedata.normalize("NFKD", sys.argv[1]).encode("ascii", "ignore").decode()
print(re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-"))
' "$TITLE")
fi
[[ $ID =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] ||
  die "nome file non valido: '$ID'. Usa ID=nome-del-mix (solo lettere minuscole, numeri e trattini)"

MP3="audio/$ID.mp3"
PEAKS="data/peaks/$ID.json"
COVER_WEB="assets/img/covers/$ID.jpg"

if [[ ${FORCE:-0} != 1 ]]; then
  for file in "$MP3" "$PEAKS" "$COVER_WEB"; do
    [[ ! -e $ROOT/$file ]] || die "$file esiste già (usa FORCE=1 per sovrascriverlo)"
  done
fi

HAS_AUDIO=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type \
  -of default=noprint_wrappers=1:nokey=1 "$INPUT" 2>/dev/null || true)
[[ $HAS_AUDIO == audio* ]] || die "nessuna traccia audio leggibile in: $INPUT"
INPUT_DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$INPUT" 2>/dev/null || true)
[[ $INPUT_DURATION =~ ^[0-9]+(\.[0-9]+)?$ ]] || INPUT_DURATION=0  # senza durata niente percentuale

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$ROOT/audio" "$ROOT/data/peaks" "$ROOT/assets/img/covers"

printf '\n«%s» → %s\n\n' "$TITLE" "$ID"

# --- 1. Misura della loudness ------------------------------------------------------
printf '  1/4  Misuro la loudness (può richiedere qualche minuto)…\n'
TOTAL_US=$(awk -v d="$INPUT_DURATION" 'BEGIN { printf "%d", d * 1000000 }')
run_ffmpeg "$TMP/pass1.log" -i "$INPUT" -map 0:a:0 \
  -af "loudnorm=I=$TARGET_I:TP=$TARGET_TP:LRA=$TARGET_LRA:print_format=json" -f null -
read -r M_I M_TP M_LRA M_THRESH M_OFFSET < <(
  loudnorm_values "$TMP/pass1.log" input_i input_tp input_lra input_thresh target_offset
) || die "impossibile leggere le misure di loudnorm"

# --- 2. Normalizzazione e codifica -------------------------------------------------
printf "  2/4  Normalizzo a %s LUFS e codifico l'MP3 a %s CBR…\n" "$TARGET_I" "$BITRATE"
LOUDNORM="loudnorm=I=$TARGET_I:TP=$TARGET_TP:LRA=$TARGET_LRA"
LOUDNORM+=":measured_I=$M_I:measured_TP=$M_TP:measured_LRA=$M_LRA"
LOUDNORM+=":measured_thresh=$M_THRESH:offset=$M_OFFSET:linear=true:print_format=json"
run_ffmpeg "$TMP/pass2.log" -i "$INPUT" -i "$COVER" \
  -map 0:a:0 -map 1:v:0 \
  -af "$LOUDNORM" -ar "$SAMPLE_RATE" \
  -c:a libmp3lame -b:a "$BITRATE" \
  -vf "scale=w='min($COVER_EMBED_MAX,iw)':h='min($COVER_EMBED_MAX,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" \
  -c:v mjpeg -q:v 3 \
  -disposition:v:0 attached_pic \
  -metadata:s:v:0 title="Album cover" -metadata:s:v:0 comment="Cover (front)" \
  -id3v2_version 3 \
  -metadata title="$TITLE" -metadata artist="$ARTIST" -metadata album_artist="$ARTIST" \
  -metadata date="$YEAR" \
  -f mp3 "$TMP/out.mp3"
read -r OUT_I OUT_TP NORM_TYPE < <(
  loudnorm_values "$TMP/pass2.log" output_i output_tp normalization_type
) || die "impossibile leggere il risultato di loudnorm"
add_id3_comment "$TMP/out.mp3" "$SITE_URL" || die "impossibile scrivere il commento ID3"

# --- 3. Picchi della forma d'onda ----------------------------------------------------
printf "  3/4  Calcolo la forma d'onda…\n"
ffmpeg -hide_banner -nostdin -v error -i "$TMP/out.mp3" -map 0:a:0 \
  -ac 1 -ar "$PEAKS_RATE" -f s16le -acodec pcm_s16le - |
  python3 -I -c "$PEAKS_PY" "$PEAKS_POINTS" "$TMP/peaks.json" ||
  die "calcolo dei picchi non riuscito"

# --- 4. Copertina per il sito --------------------------------------------------------
printf '  4/4  Preparo la copertina per il sito…\n'
TOTAL_US=0
run_ffmpeg "$TMP/cover.log" -i "$COVER" \
  -vf "scale=$COVER_WEB_SIZE:$COVER_WEB_SIZE:force_original_aspect_ratio=increase,crop=$COVER_WEB_SIZE:$COVER_WEB_SIZE" \
  -q:v 3 -frames:v 1 -update 1 "$TMP/cover.jpg"

# --- Risultato -----------------------------------------------------------------------
DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$TMP/out.mp3")
DURATION=$(awk -v d="$DURATION" 'BEGIN { printf "%.2f", d }')

mv -f "$TMP/out.mp3" "$ROOT/$MP3"
mv -f "$TMP/peaks.json" "$ROOT/$PEAKS"
mv -f "$TMP/cover.jpg" "$ROOT/$COVER_WEB"

SIZE=$(stat -c %s "$ROOT/$MP3")
SIZE_MB=$(awk -v s="$SIZE" 'BEGIN { printf "%.1f", s / 1048576 }')
CLOCK=$(awk -v d="$DURATION" 'BEGIN { s = int(d + 0.5); printf "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60 }')
if [[ $NORM_TYPE == linear ]]; then
  NORM_LABEL="gain lineare, dinamica invariata"
else
  NORM_LABEL="normalizzazione dinamica: il gain lineare avrebbe superato il true peak"
fi

SNIPPET=$(python3 -I -c '
import json, sys
id_, title, date, duration = sys.argv[1:5]
print(json.dumps({
    "id": id_,
    "title": title,
    "date": date,
    "duration": float(duration),
    "file": id_ + ".mp3",
    "peaks": "data/peaks/" + id_ + ".json",
    "cover": "assets/img/covers/" + id_ + ".jpg",
}, ensure_ascii=False, indent=2))
' "$ID" "$TITLE" "$DATE" "$DURATION")

if [[ -n ${JSON_OUT:-} ]]; then
  printf '%s\n' "$SNIPPET" >"$JSON_OUT"
fi

cat <<EOF

Fatto.

  MP3          $MP3
  Picchi       $PEAKS
  Copertina    $COVER_WEB

  Durata       $DURATION secondi ($CLOCK)
  Dimensione   $SIZE byte ($SIZE_MB MB)
  Loudness     $M_I → $OUT_I LUFS, true peak $OUT_TP dBTP ($NORM_LABEL)

Da aggiungere in data/tracks.json (campi facoltativi: "description", "tracklist"):

$SNIPPET

Se gli audio stanno su Cloudflare R2, carica $MP3 nel bucket con
Content-Type audio/mpeg (vedi README).
EOF
