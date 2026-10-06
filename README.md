# Iacopo — sito

Sito di Iacopo, DJ: i mix si ascoltano direttamente qui, con un player che
mostra la forma d'onda, invece che su SoundCloud.

È un sito statico (HTML, CSS e JavaScript, senza build, database o backend):
si pubblica caricando la cartella così com'è su qualsiasi hosting statico
(Aruba via FTP, Cloudflare Pages, GitHub Pages…). Nessun cookie, nessun
analytics e nessuna risorsa da CDN esterne, quindi non serve il banner dei cookie.

## Indice

- [Struttura](#struttura)
- [Prima di pubblicare: segnaposto da sostituire](#prima-di-pubblicare-segnaposto-da-sostituire)
- [Provare il sito in locale](#provare-il-sito-in-locale)
- [Aggiungere un mix](#aggiungere-un-mix)
- [Aggiungere una data](#aggiungere-una-data)
- [Pubblicare su Aruba via FTP](#a-pubblicare-su-aruba-via-ftp)
- [Pubblicare su Cloudflare Pages con gli audio su R2](#b-pubblicare-su-cloudflare-pages-con-gli-audio-su-r2)
- [Personalizzare](#personalizzare)
- [Dati di prova](#dati-di-prova)
- [Verifiche nei browser](#verifiche-nei-browser)
- [Librerie](#librerie)

## Struttura

```
index.html                 pagina unica: hero, mix, date, bio, booking, footer
css/style.css              stile (colore d'accento in cima al file)
js/config.js               AUDIO_BASE_URL e nome dell'artista
js/main.js                 card dei mix, lista delle date, dettagli dell'interfaccia
js/player.js               player, forme d'onda, schermata di blocco, tastiera
js/anim.js                 animazioni Lottie, caricate solo quando servono
js/vendor/                 wavesurfer.js e lottie-web (versione fissata) con licenze
data/tracks.json           elenco dei mix
data/events.json           elenco delle date
data/peaks/                forme d'onda precalcolate (restano sempre sul sito)
audio/                     MP3, se non usi uno storage esterno
assets/img/                foto, copertine, favicon, immagine di anteprima
assets/lottie/             animazioni (segnaposto da sostituire)
scripts/convert.sh         prepara un mix: MP3 + forma d'onda + copertina
scripts/make-test-data.sh  genera i dati di prova
scripts/serve.py           server locale con supporto alle richieste Range
.htaccess                  cache e tipi di file su Apache/Aruba (facoltativo)
_headers                   cache su Cloudflare Pages (facoltativo)
```

Come funziona il player, in breve:

- C'è un solo elemento `<audio preload="none">`: finché non premi play il
  browser non scarica nemmeno un byte di audio.
- Le forme d'onda le disegna wavesurfer.js partendo dai file in `data/peaks/`,
  generati da `convert.sh`: l'audio non viene mai scaricato né decodificato per
  disegnarle, quindi niente banda in più e niente problemi di CORS.
- Le forme d'onda delle card si creano solo quando la card sta per entrare nello schermo.

## Prima di pubblicare: segnaposto da sostituire

| Segnaposto | Dove | Cosa mettere |
| --- | --- | --- |
| `[DOMINIO]` | `index.html` (canonical, Open Graph, Twitter, dati strutturati), `scripts/convert.sh` (`SITE_URL`) | il dominio, es. `www.tuodominio.it` |
| `[INSTAGRAM_URL]` | `index.html` (hero, booking, dati strutturati) | es. `https://www.instagram.com/nomeutente/` |
| `[ALTRI SOCIAL]` | `index.html`, commenti nella hero e nel booking | copia la riga di Instagram per ogni social |
| `[EMAIL]` | `index.html`, sezione booking (2 volte) | l'indirizzo per il booking |
| `[P.IVA]` | `index.html`, footer | la partita IVA, oppure elimina lo `<span>` |
| `[CITTÀ]` e testi tra `[ ]` | `index.html`, sezione bio | la bio vera |
| claim | `index.html`, `hero__claim` | testo provvisorio: «Selezioni per la notte, da ascoltare qui.» |
| foto | `assets/img/hero.jpg` | foto 4:5, es. 1200 × 1500 (se cambi misure aggiorna `width`/`height` nel tag `<img>`) |
| anteprima social | `assets/img/og-image.jpg` | immagine 1200 × 630 |
| animazioni | `assets/lottie/*.json` | vedi [Personalizzare](#personalizzare) |
| dati di prova | `data/`, `assets/img/covers/` | vedi [Dati di prova](#dati-di-prova) |

Per trovarli tutti:

```sh
grep -rn '\[DOMINIO\]\|\[INSTAGRAM_URL\]\|\[ALTRI SOCIAL\]\|\[EMAIL\]\|\[P.IVA\]\|\[CITTÀ\]' index.html scripts/
```

## Provare il sito in locale

Il sito va aperto tramite un server: con un doppio clic su `index.html`
(indirizzo `file://`) il browser blocca il caricamento dei dati.

Dalla cartella del progetto:

```sh
python3 -m http.server 8000
```

e apri <http://localhost:8000>. Basta per vedere pagina, mix e date, ma questo
server non supporta le richieste HTTP Range. Di conseguenza il salto in un
punto del mix non funziona (in Chrome il mix riparte dall'inizio) e Safari non
riproduce l'audio. Su Aruba, Cloudflare e GitHub Pages il problema non c'è.

Per una prova completa usa il server incluso (solo libreria standard di Python):

```sh
python3 scripts/serve.py          # http://localhost:8000
python3 scripts/serve.py --lan    # anche dagli altri dispositivi della rete
```

Con `--lan` lo script stampa un indirizzo tipo `http://192.168.1.20:8000`:
aprilo dall'iPhone collegato allo stesso Wi-Fi per provare Safari iOS.

## Aggiungere un mix

### 1. Installa ffmpeg e python3 (una volta sola)

```sh
sudo apt install ffmpeg python3      # Ubuntu
sudo pacman -S ffmpeg python         # Arch
```

### 2. Converti il master

```sh
scripts/convert.sh ~/Musica/mix-ottobre.wav "Mix di ottobre" ~/Immagini/copertina.jpg
```

Lo script:

- normalizza la loudness a **-14 LUFS**, con true peak massimo -1 dBTP. Usa due
  passaggi: prima misura, poi applica un guadagno lineare, così la dinamica
  del mix non viene toccata;
- crea `audio/mix-di-ottobre.mp3`: **192 kbps CBR**, 44,1 kHz, tag ID3 (titolo,
  artista Iacopo, anno, commento con l'indirizzo del sito) e copertina incorporata;
- crea `data/peaks/mix-di-ottobre.json`, i picchi della forma d'onda nel formato
  dell'opzione `peaks` di wavesurfer.js (un array di canali, 1600 punti, circa 8 KB).
  Ogni punto è l'energia media (RMS) di un segmento: in un mix compresso il
  picco puro è quasi sempre al massimo, così invece si vedono drop e breakdown;
- crea `assets/img/covers/mix-di-ottobre.jpg`, la copertina 600 × 600 per il sito;
- stampa durata e dimensione e il blocco da copiare in `data/tracks.json`.

Opzioni, da mettere prima del comando:

| Variabile | Effetto |
| --- | --- |
| `DATE=2026-10-20` | data del mix (default: oggi); l'anno va nei tag ID3 |
| `ID=ottobre-2026` | nome dei file (default: ricavato dal titolo) |
| `FORCE=1` | sovrascrive i file esistenti (di default lo script si ferma) |

Esempio: `DATE=2026-10-20 scripts/convert.sh master.wav "Mix di ottobre" cover.jpg`

### 3. Aggiungi il mix a `data/tracks.json`

Incolla il blocco stampato dallo script dentro l'array, separato dagli altri da
una virgola. L'ordine non conta: il sito mostra i mix dal più recente.

```json
[
  {
    "id": "mix-di-ottobre",
    "title": "Mix di ottobre",
    "date": "2026-10-20",
    "duration": 3725.42,
    "file": "mix-di-ottobre.mp3",
    "peaks": "data/peaks/mix-di-ottobre.json",
    "cover": "assets/img/covers/mix-di-ottobre.jpg",
    "description": "Facoltativa: una o due frasi sul mix.",
    "tracklist": ["Artista — Titolo", "Artista — Titolo (Remix)"]
  }
]
```

| Campo | Obbligatorio | Note |
| --- | --- | --- |
| `id` | sì | unico per ogni mix |
| `title` | sì | |
| `date` | sì | formato `AAAA-MM-GG` |
| `duration` | sì | in secondi, la stampa `convert.sh` |
| `file` | sì | nome dell'MP3; l'indirizzo completo dipende da `AUDIO_BASE_URL` |
| `peaks` | consigliato | se manca o non si carica, al posto della forma d'onda c'è una linea piatta |
| `cover` | consigliato | |
| `description` | no | |
| `tracklist` | no | array di stringhe, compare in un pannello apribile |

Per controllare di non aver rotto il JSON (una virgola di troppo, per esempio):

```sh
python3 -m json.tool data/tracks.json > /dev/null && echo OK
```

### 4. Carica i file

- Aruba: carica l'MP3 in `audio/`, più `data/tracks.json`, il file dei picchi e
  la copertina ([dettagli](#a-pubblicare-su-aruba-via-ftp)).
- Cloudflare: carica l'MP3 su R2 e pubblica il resto con Pages
  ([dettagli](#b-pubblicare-su-cloudflare-pages-con-gli-audio-su-r2)).

Per **sostituire** un MP3 già pubblicato usa un nome nuovo (per esempio con
`ID=…`): browser e CDN possono tenere in cache il vecchio file per giorni.
Per **togliere** un mix basta eliminarlo da `data/tracks.json`.

## Aggiungere una data

In `data/events.json`:

```json
[
  { "date": "2026-11-14", "venue": "Nome del locale", "city": "Milano", "link": "https://…" },
  { "date": "2026-12-31", "venue": "Capodanno al Club", "city": "Roma" }
]
```

`link` è facoltativo (biglietti o pagina dell'evento). Le date passate si
nascondono da sole il giorno dopo la serata; se non ci sono date future il sito
mostra «Nuove date in arrivo».

## Pubblicare

Prima di pubblicare sostituisci i [segnaposto](#prima-di-pubblicare-segnaposto-da-sostituire)
e togli i [dati di prova](#dati-di-prova).

### (a) Pubblicare su Aruba via FTP

Qui gli MP3 stanno sullo stesso hosting, nella cartella `audio/`, e
`AUDIO_BASE_URL` in `js/config.js` resta vuoto (`''`).

1. Dal pannello Aruba attiva il certificato SSL, per avere il sito in HTTPS.
2. Recupera le credenziali FTP dal pannello Aruba e collegati con un client
   FTP, per esempio FileZilla. Se è disponibile, usa la connessione cifrata
   (FTP su TLS esplicito).
3. Carica nella cartella pubblica del sito, che su Aruba di solito è la
   cartella principale dell'FTP (se vedi una cartella come `www.tuodominio.it`
   o `public_html`, usa quella):
   - `index.html`, `.htaccess`
   - le cartelle `css/`, `js/`, `data/`, `assets/`, `audio/` (con gli MP3)

   Non servono `scripts/`, `README.md`, `_headers` e `.gitignore`. Alcuni
   client FTP nascondono i file che iniziano con il punto: assicurati di
   caricare anche `.htaccess`.
4. A ogni nuovo mix carica `audio/<nome>.mp3`, `data/peaks/<nome>.json`,
   `assets/img/covers/<nome>.jpg` e il nuovo `data/tracks.json`.
5. Verifica dal terminale che l'MP3 arrivi con il tipo giusto e con il supporto Range:

   ```sh
   curl -sI https://www.tuodominio.it/audio/mix-di-ottobre.mp3 | grep -i -E 'content-type|accept-ranges'
   # content-type: audio/mpeg
   # accept-ranges: bytes
   ```

Un'ora di mix a 192 kbps pesa circa 86 MB: controlla lo spazio incluso nel tuo
piano Aruba.

### (b) Pubblicare su Cloudflare Pages con gli audio su R2

Cloudflare Pages accetta file fino a 25 MB, quindi gli MP3 vanno su R2, lo
storage di Cloudflare. R2 non fa pagare il traffico in uscita: verifica sul sito
di Cloudflare prezzi e quota gratuita attuali. Serve che il dominio sia gestito
dai DNS di Cloudflare.

**1. Crea il bucket.** Dashboard Cloudflare → R2 → *Create bucket*, per
esempio `iacopo-audio`.

**2. Collega un sottodominio.** Nel bucket: *Settings* → *Custom Domains* →
*Connect Domain* → `audio.tuodominio.it`. Cloudflare crea da solo il record DNS
e il certificato. Lascia disattivato il sottodominio `r2.dev`: ha limiti di
traffico ed è pensato solo per lo sviluppo, non per la produzione.

**3. Carica gli MP3 con `Content-Type: audio/mpeg`.** Scegli uno di questi tre modi.

- **Dashboard**: bucket → *Objects* → *Upload*. Comodo per pochi file (fino a
  300 MB l'uno). Dopo il caricamento verifica il tipo come al punto 4.
- **rclone**, comodo per tanti file. Prima crea una chiave in R2 → *Manage API
  tokens* e configura un remote S3 di tipo Cloudflare con `rclone config`
  (qui si chiama `r2`). Poi:

  ```sh
  rclone copy audio/ r2:iacopo-audio --include "*.mp3" \
    --header-upload "Content-Type: audio/mpeg" \
    --header-upload "Cache-Control: public, max-age=31536000"
  ```

- **wrangler**, la riga di comando di Cloudflare (richiede Node.js sul tuo computer):

  ```sh
  npx wrangler r2 object put iacopo-audio/mix-di-ottobre.mp3 --remote \
    --file audio/mix-di-ottobre.mp3 --content-type audio/mpeg \
    --cache-control "public, max-age=31536000"
  ```

**4. Verifica:**

```sh
curl -sI https://audio.tuodominio.it/mix-di-ottobre.mp3 | grep -i -E 'content-type|accept-ranges'
# content-type: audio/mpeg
# accept-ranges: bytes
```

**5. Imposta l'indirizzo degli audio** in `js/config.js`:

```js
export const AUDIO_BASE_URL = 'https://audio.tuodominio.it/';
```

**6. Pubblica il sito con Pages.** Dashboard → *Workers & Pages* → *Create* → *Pages*.

- Collegando il repository GitHub: *Framework preset* None, *Build command*
  vuoto, *Build output directory* `/`. Gli MP3 sono già esclusi da `.gitignore`.
  A ogni push il sito si aggiorna da solo.
- Oppure con *Upload assets* (caricamento diretto): trascina la cartella del
  progetto **senza** `audio/`, altrimenti gli MP3 superano il limite di 25 MB.

Poi, nel progetto Pages: *Custom domains* → `tuodominio.it` e/o `www.tuodominio.it`.

Note:

- **CORS non serve**: l'audio lo riproduce l'elemento `<audio>` e le forme
  d'onda arrivano da `data/peaks/` sul sito. Non aggiungere l'attributo
  `crossorigin` all'`<audio>`, altrimenti R2 dovrebbe rispondere con le
  intestazioni CORS.
- Gli audio stanno su R2, ma i file dei picchi (`data/peaks/`) restano sempre su Pages.
- Per restare senza analytics, non attivare *Web Analytics* nel progetto Pages.

## Personalizzare

- **Colore d'accento**: in cima a `css/style.css` modifica `--accent` e
  `--accent-rgb` (lo stesso colore, in esadecimale e in RGB). Lo usano anche
  forme d'onda e animazioni.
- **Nome dell'artista**: `ARTIST_NAME` in `js/config.js` (player e schermata di
  blocco), `ARTIST` in `scripts/convert.sh` (tag ID3) e i testi di `index.html`.
  Il titolo della hero è dimensionato per «IACOPO»: con un nome più lungo
  riduci `font-size` di `.hero__title` in `css/style.css`.
- **Animazioni Lottie**: sostituisci `assets/lottie/equalizer.json` (traccia in
  riproduzione), `loader.json` (caricamento) e `logo.json` (hero) con file dallo
  stesso nome. Il sito usa la versione «light» di lottie-web, che disegna solo
  in SVG e non supporta le espressioni di After Effects. Le animazioni si
  scaricano solo quando servono e restano ferme su un fotogramma se il sistema
  chiede di ridurre il movimento. I segnaposto prendono il colore d'accento
  grazie alla classe `lottie-tint`: se le tue animazioni hanno già i loro
  colori, togli la classe in `index.html` (logo e loader) e in `js/main.js`
  (equalizzatore).
- **Font**: il sito usa i font di sistema. Per un font tuo, mettine i file
  `.woff2` in `assets/fonts/`, aggiungi una regola `@font-face` in `style.css`
  e cambia `--font-sans`. Non usare Google Fonts o altre CDN.

## Dati di prova

`scripts/make-test-data.sh` genera con ffmpeg 3 mix di prova (toni sintetici di
2–4 minuti, passati da `convert.sh`) con copertine, forme d'onda e alcune date
finte, una delle quali già passata. Gli MP3 di prova non sono in git: per
rigenerarli, compresi gli audio, lancia lo script (circa un minuto).

Lo script si rifiuta di sovrascrivere `tracks.json` ed `events.json` se
contengono dati veri. Se serve davvero, usa `FORCE=1`.

Prima di pubblicare togli i dati di prova:

```sh
echo '[]' > data/tracks.json
echo '[]' > data/events.json
rm -f data/peaks/test-mix-*.json assets/img/covers/test-mix-*.jpg audio/test-mix-*.mp3
```

## Verifiche nei browser

Il sito supporta le versioni recenti di Chrome, Firefox, Safari (macOS e iOS) ed
Edge. Checklist rapida, da ripetere su Chrome, Firefox e Safari iOS:

1. Apri gli strumenti per sviluppatori → *Rete*, filtra `mp3`, ricarica e scorri
   tutta la pagina: **nessuna richiesta MP3**, mentre le forme d'onda compaiono
   (richieste a `data/peaks/*.json`).
2. Premi play su una card: il mix parte, la barra entra dal basso, la card si
   evidenzia con l'equalizzatore e solo ora compare la richiesta dell'MP3.
3. Clicca a metà della forma d'onda di un altro mix: parte da quel punto.
4. Barra spaziatrice = play/pausa. Con Tab porta il focus sulla forma d'onda
   della barra: le frecce spostano di 5 secondi (con Maiusc di 30).
5. Precedente/successiva; a fine traccia il player si ferma e non passa al mix successivo.
6. Su iPhone blocca lo schermo: titolo, copertina, controlli e avanzamento sono
   nella schermata di blocco e l'audio continua.
7. Attiva «Riduci movimento» (iOS: *Impostazioni → Accessibilità → Movimento*):
   le animazioni restano ferme.
8. Rinomina per un momento un MP3 e premi play: nella barra compare un messaggio
   d'errore e il resto del sito continua a funzionare.

## Librerie

Le uniche dipendenze, già incluse in `js/vendor/` con versione fissata e licenza.
Sono state scaricate dal registro ufficiale npm con verifica dell'integrità
(sha512), senza usare npm nel progetto.

| Libreria | Versione | File | Licenza |
| --- | --- | --- | --- |
| [wavesurfer.js](https://wavesurfer.xyz) | 7.12.12 (ultima 7.x) | `wavesurfer-7.12.12.esm.js` | BSD-3-Clause |
| [lottie-web](https://github.com/airbnb/lottie-web) | 5.13.0, build `lottie_light` (solo SVG) | `lottie_light-5.13.0.min.js` | MIT |

SHA-256 dei file, per controllarli con `sha256sum js/vendor/*.js`:

```
1bca765cc75bc4af079ecd1b2edd659b155e5d1715e75a29d68272d9f141f951  wavesurfer-7.12.12.esm.js
9588432bec30c8ef8200bac4a67d8aaad881047bc2a6c9fa624d90ec96402410  lottie_light-5.13.0.min.js
```

Per aggiornarle: scarica il pacchetto da
`https://registry.npmjs.org/<nome>/-/<nome>-<versione>.tgz`, controlla l'hash
indicato nel campo `dist.integrity` di `https://registry.npmjs.org/<nome>/<versione>`,
copia il file in `js/vendor/` con la nuova versione nel nome e aggiorna i
percorsi in `js/player.js`, `js/anim.js` e `index.html` (`modulepreload`).
