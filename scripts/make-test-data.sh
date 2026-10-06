#!/usr/bin/env bash
#
# make-test-data.sh — dati di prova per provare il sito senza musica vera.
#
# Genera con ffmpeg 3 tracce sintetiche (toni di qualche minuto con un inviluppo,
# così la forma d'onda ha una struttura), le converte con scripts/convert.sh
# (MP3 + picchi + copertina) e riscrive data/tracks.json e data/events.json con
# le tracce di prova e alcune date finte, di cui una già passata.
#
# Uso: scripts/make-test-data.sh
# Se data/tracks.json o data/events.json contengono già dati veri, lo script si
# ferma: con FORCE=1 li sovrascrive comunque.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

die() {
  printf '\nErrore: %s\n' "$*" >&2
  exit 1
}

for cmd in ffmpeg ffprobe python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "manca '$cmd' (vedi README, sezione «Aggiungere un mix»)"
done

# Non sovrascrivere dati veri: i mix di prova hanno id "test-…", le date "… di prova".
if [[ ${FORCE:-0} != 1 ]]; then
  python3 -I - "$ROOT/data/tracks.json" "$ROOT/data/events.json" <<'PY' ||
import json, os, sys

def load(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)

tracks, events = load(sys.argv[1]), load(sys.argv[2])
only_test = all(str(t.get("id", "")).startswith("test-") for t in tracks) and all(
    "di prova" in str(e.get("venue", "")) for e in events
)
sys.exit(0 if only_test else 1)
PY
    die "data/tracks.json o data/events.json contengono dati veri: non li sovrascrivo (usa FORCE=1)"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

day() { date -d "$1 days" +%F; }

# make_cover <file.png> <colore 1> <colore 2> <numero> <sottotitolo>
make_cover() {
  local out=$1 c1=$2 c2=$3 num=$4 subtitle=$5 bars
  bars=$(awk -v seed="$num" 'BEGIN {
    for (i = 0; i < 44; i++) {
      h = 60 + 300 * (0.5 + 0.5 * sin(i * 0.55 + seed)) * (0.55 + 0.45 * sin(i * 0.21 + seed * 2))
      printf "<rect x=\"%d\" y=\"%.1f\" width=\"12\" height=\"%.1f\" rx=\"6\"/>", 80 + i * 24, 520 - h / 2, h
    }
  }')
  cat >"$TMP/cover.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <radialGradient id="g" cx="0.25" cy="0.2" r="1.1">
      <stop offset="0" stop-color="$c1"/>
      <stop offset="0.55" stop-color="$c2"/>
      <stop offset="1" stop-color="#050506"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#g)"/>
  <g fill="#f3f3ef" fill-opacity="0.9">$bars</g>
  <text x="80" y="1010" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800"
        font-size="150" letter-spacing="-6" fill="#f3f3ef">TEST MIX $num</text>
  <text x="84" y="1100" font-family="DejaVu Sans Mono, monospace" font-size="42"
        fill="#f3f3ef" fill-opacity="0.7">$subtitle</text>
</svg>
EOF
  # Serve un ffmpeg con librsvg (Ubuntu e Arch ce l'hanno); altrimenti tinta unita.
  ffmpeg -hide_banner -nostdin -v error -y -i "$TMP/cover.svg" -frames:v 1 -update 1 "$out" 2>/dev/null ||
    ffmpeg -hide_banner -nostdin -v error -y -f lavfi -i "color=c=$c2:s=1200x1200" -frames:v 1 -update 1 "$out"
}

# make_track <id> <titolo> <secondi> <data> <espressione del segnale> <colore 1> <colore 2> <numero> <sottotitolo>
make_track() {
  local id=$1 title=$2 seconds=$3 date=$4 expr=$5
  printf '  %s (%s s)…\n' "$title" "$seconds"
  ffmpeg -hide_banner -nostdin -v error -y \
    -f lavfi -i "aevalsrc=exprs='$expr|$expr':s=44100:d=$seconds" \
    -c:a pcm_s16le "$TMP/$id.wav"
  make_cover "$TMP/$id.png" "$6" "$7" "$8" "$9"
  ID=$id DATE=$date FORCE=1 JSON_OUT="$TMP/$id.json" \
    "$ROOT/scripts/convert.sh" "$TMP/$id.wav" "$title" "$TMP/$id.png" >/dev/null
}

# Inviluppi a tratti (intro, break, drop, outro) moltiplicati per un impulso sul beat.
pulse() { echo "(0.55+0.45*pow(abs(sin(PI*t*$1/60)),6))"; }

ENV1="if(lt(t,15),t/15*0.8,if(lt(t,60),0.8,if(lt(t,80),0.3,if(lt(t,95),0.3+0.7*(t-80)/15,if(lt(t,135),1,max(0,(150-t)/15))))))"
ENV2="if(lt(t,30),0.2+0.5*t/30,if(lt(t,90),0.7,if(lt(t,110),0.25,if(lt(t,130),0.25+0.75*(t-110)/20,if(lt(t,200),1,if(lt(t,215),0.5,max(0,0.5*(240-t)/25)))))))"
ENV3="if(lt(t,20),t/20*0.6,if(lt(t,70),0.6,if(lt(t,100),0.9,if(lt(t,120),0.2,if(lt(t,160),1,max(0,(180-t)/20))))))"

printf '\nGenero le tracce di prova:\n'
make_track test-mix-01 "Test Mix 01 — Warm Up" 150 "$(day -41)" \
  "0.5*$ENV1*$(pulse 118)*(0.7*sin(2*PI*110*t)+0.3*sin(2*PI*220*t))" \
  "#1f6f63" "#0b2a2a" 01 "Warm Up · tono 110 Hz"
make_track test-mix-02 "Test Mix 02 — Peak Time" 240 "$(day -19)" \
  "0.5*$ENV2*$(pulse 126)*(0.6*sin(2*PI*98*t)+0.25*sin(2*PI*196*t)+0.15*(2*random(0)-1))" \
  "#7a2a8c" "#2a0f33" 02 "Peak Time · tono 98 Hz"
make_track test-mix-03 "Test Mix 03 — Closing" 180 "$(day -4)" \
  "0.5*$ENV3*$(pulse 122)*(0.7*sin(2*PI*82.4*t)+0.3*sin(2*PI*164.8*t))" \
  "#b5541c" "#3a1a0a" 03 "Closing · tono 82 Hz"

python3 -I - "$ROOT/data/tracks.json" "$TMP"/test-mix-0{1,2,3}.json <<'PY'
import json, sys

extra = {
    "test-mix-01": {
        "description": "Traccia di prova generata con ffmpeg: un tono a 110 Hz con intro, break e drop, per verificare player e forma d'onda.",
        "tracklist": ["Tono di prova — 110 Hz", "Tono di prova — 220 Hz"],
    },
    "test-mix-02": {
        "description": "Traccia di prova più lunga, con un po' di rumore per dare corpo alla forma d'onda.",
        "tracklist": [
            "Artista di prova — Primo brano",
            "Artista di prova — Secondo brano",
            "Artista di prova — Terzo brano (Remix)",
            "Artista di prova — Quarto brano",
            "Artista di prova — Quinto brano",
        ],
    },
}
tracks = []
for path in sys.argv[2:]:
    with open(path, encoding="utf-8") as f:
        track = json.load(f)
    track.update(extra.get(track["id"], {}))
    tracks.append(track)
tracks.sort(key=lambda t: t["date"], reverse=True)
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(tracks, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

cat >"$ROOT/data/events.json" <<EOF
[
  {
    "date": "$(day -12)",
    "venue": "Locale di prova (data passata, non deve comparire)",
    "city": "Bologna",
    "link": "https://example.com/"
  },
  {
    "date": "$(day 11)",
    "venue": "Club di prova",
    "city": "Milano",
    "link": "https://example.com/"
  },
  {
    "date": "$(day 32)",
    "venue": "Festival di prova",
    "city": "Roma"
  },
  {
    "date": "$(day 67)",
    "venue": "Warehouse di prova",
    "city": "Torino",
    "link": "https://example.com/"
  }
]
EOF

printf '\nFatto: 3 mix in audio/, picchi in data/peaks/, copertine in assets/img/covers/,\n'
printf 'data/tracks.json e data/events.json aggiornati.\n'
