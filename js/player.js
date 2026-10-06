// Player: un solo <audio preload="none"> condiviso da tutte le tracce.
// Le forme d'onda (barra e card) le disegna wavesurfer.js con i picchi
// precalcolati in data/peaks/: per disegnarle l'audio non viene mai scaricato
// né decodificato, quindi niente banda in più e niente CORS.

import { ARTIST_NAME, AUDIO_BASE_URL } from './config.js';
import { createAnimation } from './anim.js';

// Importata a parte: se mancasse, il player funziona lo stesso, senza forme d'onda.
const wavesurferReady = import('./vendor/wavesurfer-7.12.12.esm.js')
  .then((module) => module.default)
  .catch((error) => {
    console.warn('wavesurfer.js non disponibile:', error);
    return null;
  });

const RESTART_AFTER = 3;      // "precedente" oltre questi secondi riavvia il mix
const BUFFERING_DELAY = 350;  // ms prima di mostrare il caricamento, evita sfarfallii
const SEEK_STEP = 5;          // frecce sulla forma d'onda della barra (s)
const SEEK_STEP_LARGE = 30;   // con Maiusc
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;
const FLAT_PEAKS = [new Float32Array(2000).fill(0.04)];

const ERROR_MESSAGES = {
  1: 'Caricamento interrotto. Premi play per riprovare.',
  2: 'Errore di rete. Controlla la connessione e premi play.',
  3: 'Il file audio è danneggiato.',
  4: 'File audio non trovato o formato non supportato.',
};

const SPACE_IGNORED_ON =
  'button, summary, select, textarea, input:not([type="range"]), [contenteditable]:not([contenteditable="false"])';

export function formatTime(value) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// --- Picchi -------------------------------------------------------------------

const peaksRequests = new Map(); // percorso → Promise
const peaksLoaded = new Map();   // percorso → picchi già arrivati

function loadPeaks(track) {
  if (!track.peaks) return Promise.resolve(null);
  if (!peaksRequests.has(track.peaks)) {
    const request = fetch(track.peaks)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(normalizePeaks)
      .catch((error) => {
        console.warn(`Picchi non disponibili per "${track.title}":`, error.message);
        return null;
      })
      .then((peaks) => {
        peaksLoaded.set(track.peaks, peaks);
        return peaks;
      });
    peaksRequests.set(track.peaks, request);
  }
  return peaksRequests.get(track.peaks);
}

// Accetta il formato di wavesurfer (array di canali) o un array semplice e
// riporta i valori tra 0 e 1.
function normalizePeaks(data) {
  const channels = Array.isArray(data) && Array.isArray(data[0]) ? data.slice(0, 2) : [data];
  if (!Array.isArray(channels[0]) || channels[0].length === 0) throw new Error('formato non valido');
  let max = 0;
  const parsed = channels.map((channel) =>
    Float32Array.from(channel, (value) => {
      const amplitude = Math.abs(Number(value)) || 0;
      if (amplitude > max) max = amplitude;
      return amplitude;
    }),
  );
  if (max > 0 && max !== 1) parsed.forEach((channel) => channel.forEach((v, i) => (channel[i] = v / max)));
  return parsed;
}

// --- Forme d'onda -------------------------------------------------------------

function waveOptions(container, track, peaks) {
  const style = getComputedStyle(document.documentElement);
  const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    container,
    height: 'auto',
    waveColor: token('--wave', '#55555b'),
    progressColor: token('--accent', '#c6ff3d'),
    cursorColor: token('--text', '#f3f3ef'),
    cursorWidth: 0,
    barWidth: 2,
    barGap: 2,
    barRadius: 2,
    normalize: false,
    hideScrollbar: true,
    autoScroll: false,
    autoCenter: false,
    peaks: peaks || FLAT_PEAKS,
    duration: track.duration,
  };
}

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

// Linea verticale con il minuto corrispondente al passaggio del mouse.
function attachHover(container, getDuration) {
  const line = container.querySelector('.wave__hover');
  const label = line && line.querySelector('.wave__time');
  if (!label) return;
  container.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    const rect = container.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    line.style.transform = `translateX(${x}px)`;
    label.textContent = formatTime((x / rect.width) * getDuration());
    container.classList.add('is-hovering');
  });
  container.addEventListener('pointerleave', () => container.classList.remove('is-hovering'));
}

function imageType(path) {
  const extension = path.split('.').pop().toLowerCase();
  return { png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[extension] || 'image/jpeg';
}

// --- Player -------------------------------------------------------------------

/**
 * Crea il player sulla barra `root` per le tracce date (già ordinate).
 * Restituisce un EventTarget che emette "change" con { trackId, playing, buffering }
 * e ha i metodi toggleTrack(id), playAt(id, secondi) e mountWaveform(track, container).
 */
export function createPlayer(root, tracks) {
  const api = new EventTarget();
  const find = (selector) => root.querySelector(selector);
  const audio = find('[data-audio]');
  const ui = {
    cover: find('[data-cover]'),
    title: find('[data-title]'),
    artist: find('[data-artist]'),
    status: find('[data-status]'),
    toggle: find('[data-toggle]'),
    prev: find('[data-prev]'),
    next: find('[data-next]'),
    wave: find('[data-wave]'),
    current: find('[data-current]'),
    duration: find('[data-duration]'),
    mute: find('[data-mute]'),
    volume: find('[data-volume]'),
    loader: find('[data-loader]'),
  };
  const session = 'mediaSession' in navigator ? navigator.mediaSession : null;
  const cardWaves = new Map(); // id della traccia → wavesurfer della card

  let index = -1;
  let pendingSeek = null; // posizione da applicare quando arrivano i metadati
  let barWave = null;
  let loader = null;
  let bufferingTimer = 0;
  let frame = 0;
  let shownSecond = -1;

  const current = () => tracks[index] || null;
  const isPlaying = () => !audio.paused && !audio.error;
  const currentTime = () => (pendingSeek ?? audio.currentTime) || 0;
  const duration = () =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (current() && current().duration) || 0;

  function audioUrl(file) {
    const base = new URL(AUDIO_BASE_URL || 'audio/', document.baseURI);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    return new URL(file.split('/').map(encodeURIComponent).join('/'), base).href;
  }

  // --- Scelta della traccia e riproduzione --------------------------------------

  function select(i, { at = 0, autoplay = true } = {}) {
    const track = tracks[i];
    if (!track) return;
    if (i !== index) {
      const previous = current();
      index = i;
      pendingSeek = null;
      shownSecond = -1;
      setBuffering(false);
      clearStatus();
      // Con preload="none" impostare la sorgente non scarica nulla: si parte al play.
      audio.src = audioUrl(track.file);
      if (previous) renderCardProgress(previous, 0);
      showTrack(track);
      updateMediaSession(track);
      updateNavigation();
      renderBarWaveform(track);
      revealBar();
    }
    if (at > 0) seek(at);
    renderTime(currentTime(), true);
    if (autoplay) play();
    notify();
  }

  function play() {
    if (!current()) {
      if (tracks.length) select(0);
      return;
    }
    if (audio.error) {
      // Dopo un errore la sorgente va ricaricata; si riparte da dove si era.
      const resumeAt = currentTime();
      audio.load();
      if (resumeAt > 0) seek(resumeAt);
    }
    clearStatus();
    if (audio.readyState < HAVE_FUTURE_DATA) setBuffering(true);
    const attempt = audio.play(); // chiamato dentro il clic: necessario su Safari iOS
    if (attempt) attempt.catch(onPlayRejected);
  }

  function onPlayRejected(error) {
    if (error && error.name === 'AbortError') return; // interrotto da un cambio di traccia
    setBuffering(false);
    if (audio.error) return; // il messaggio lo mostra l'evento "error"
    if (error && error.name === 'NotAllowedError') setStatus('Premi play per avviare la riproduzione.', 'info');
    else setStatus('Impossibile avviare la riproduzione.', 'error');
    notify();
  }

  function toggle() {
    if (!current()) {
      if (tracks.length) select(0);
      return;
    }
    if (isPlaying()) audio.pause();
    else play();
  }

  function next() {
    if (index < tracks.length - 1) select(index + 1, { autoplay: isPlaying() });
  }

  function previous() {
    if (!current()) return;
    if (currentTime() > RESTART_AFTER || index === 0) seek(0);
    else select(index - 1, { autoplay: isPlaying() });
  }

  function seek(time) {
    if (!current()) return;
    const total = duration();
    const target = Math.min(Math.max(0, time), total || time);
    if (audio.readyState >= HAVE_METADATA) {
      pendingSeek = null;
      audio.currentTime = target;
    } else {
      // Senza metadati Safari ignora il seek: lo si riapplica a "loadedmetadata".
      pendingSeek = target;
      try {
        audio.currentTime = target;
      } catch {
        /* vedi sopra */
      }
    }
    if (barWave && total) barWave.getRenderer().renderProgress(target / total, false);
    renderTime(target, true);
    updatePositionState();
  }

  // --- Interfaccia della barra --------------------------------------------------

  function showTrack(track) {
    ui.title.textContent = track.title;
    if (track.cover) {
      ui.cover.src = track.cover;
      ui.cover.hidden = false;
    } else {
      ui.cover.hidden = true;
    }
  }

  function revealBar() {
    if (root.classList.contains('is-visible')) return;
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
    root.classList.add('is-visible');
    // Spazio in fondo alla pagina perché la barra non copra il footer
    const reserveSpace = () =>
      document.documentElement.style.setProperty('--player-space', `${root.offsetHeight}px`);
    reserveSpace();
    if ('ResizeObserver' in window) new ResizeObserver(reserveSpace).observe(root);
  }

  function updateNavigation() {
    ui.prev.disabled = !current();
    ui.next.disabled = index >= tracks.length - 1;
    setAction('nexttrack', index < tracks.length - 1 ? next : null);
  }

  function renderTime(time, force = false) {
    const track = current();
    if (!track) return;
    const total = duration();
    renderCardProgress(track, total ? Math.min(time / total, 1) : 0);
    const second = Math.floor(time);
    if (!force && second === shownSecond) return;
    shownSecond = second;
    ui.current.textContent = formatTime(time);
    ui.duration.textContent = formatTime(total);
    ui.wave.setAttribute('aria-valuemax', String(Math.round(total)));
    ui.wave.setAttribute('aria-valuenow', String(Math.round(Math.min(time, total))));
    ui.wave.setAttribute('aria-valuetext', `${formatTime(time)} di ${formatTime(total)}`);
  }

  // Aggiornamento fluido dell'avanzamento (card e tempi) mentre suona
  function tick() {
    renderTime(currentTime());
    frame = requestAnimationFrame(tick);
  }

  function startTicking() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function stopTicking() {
    cancelAnimationFrame(frame);
    frame = 0;
    renderTime(currentTime(), true);
  }

  function setBuffering(on) {
    clearTimeout(bufferingTimer);
    if (on) {
      bufferingTimer = setTimeout(() => {
        root.classList.add('is-buffering');
        if (!loader && ui.loader) loader = createAnimation(ui.loader, 'assets/lottie/loader.json');
        if (loader) loader.play();
        setStatus('Caricamento…', 'loading');
        notify();
      }, BUFFERING_DELAY);
    } else if (root.classList.contains('is-buffering')) {
      root.classList.remove('is-buffering');
      if (loader) loader.pause();
      clearStatus('loading');
      notify();
    }
  }

  function setStatus(message, kind) {
    ui.status.textContent = message;
    root.dataset.message = kind;
  }

  function clearStatus(kind) {
    if (kind && root.dataset.message !== kind) return;
    ui.status.textContent = '';
    delete root.dataset.message;
  }

  function notify() {
    const playing = isPlaying();
    ui.toggle.classList.toggle('is-playing', playing);
    ui.toggle.setAttribute('aria-label', playing ? 'Pausa' : 'Riproduci');
    const detail = {
      trackId: current() ? current().id : null,
      playing,
      buffering: root.classList.contains('is-buffering'),
    };
    api.dispatchEvent(new CustomEvent('change', { detail }));
  }

  function renderVolume() {
    const level = audio.muted ? 0 : audio.volume;
    ui.volume.value = String(level);
    ui.volume.style.setProperty('--volume', `${level * 100}%`);
    ui.mute.classList.toggle('is-muted', level === 0);
    ui.mute.setAttribute('aria-label', level === 0 ? "Riattiva l'audio" : "Disattiva l'audio");
  }

  // --- Forme d'onda -------------------------------------------------------------

  // Va chiamata dopo almeno un "await" dal cambio di sorgente e con l'indirizzo
  // che l'elemento audio sta già usando: così wavesurfer non tocca la sorgente.
  async function renderBarWaveform(track) {
    const WaveSurfer = await wavesurferReady;
    if (!WaveSurfer || current() !== track) return;
    const ready = peaksLoaded.has(track.peaks);
    let peaks = ready ? peaksLoaded.get(track.peaks) : FLAT_PEAKS;
    try {
      if (!barWave) {
        barWave = WaveSurfer.create({ ...waveOptions(ui.wave, track, peaks), media: audio, cursorWidth: 2, dragToSeek: true });
        barWave.on('interaction', onBarInteraction);
        attachHover(ui.wave, duration);
      } else {
        await barWave.load(audio.currentSrc || audio.src, peaks || FLAT_PEAKS, track.duration);
      }
      if (ready) return;
      peaks = await loadPeaks(track);
      if (peaks && current() === track) await barWave.load(audio.currentSrc || audio.src, peaks, track.duration);
    } catch (error) {
      console.warn("Forma d'onda della barra non disponibile:", error);
    }
  }

  // wavesurfer ha già spostato l'audio: qui si gestisce il caso "metadati non ancora caricati"
  function onBarInteraction(time) {
    if (audio.readyState < HAVE_METADATA) pendingSeek = time;
    renderTime(time, true);
    updatePositionState();
  }

  function renderCardProgress(track, fraction) {
    const wave = cardWaves.get(track.id);
    if (wave) wave.getRenderer().renderProgress(fraction, false);
  }

  function mountWaveform(track, container) {
    if (cardWaves.has(track.id)) return;
    cardWaves.set(track.id, null);
    attachHover(container, () => track.duration);
    Promise.all([wavesurferReady, loadPeaks(track)]).then(([WaveSurfer, peaks]) => {
      if (!WaveSurfer) return;
      try {
        // Nessuna opzione "media": la card disegna soltanto, l'audio è quello della barra.
        const wave = WaveSurfer.create(waveOptions(container, track, peaks));
        wave.on('click', (relativeX) => playAt(track.id, relativeX * track.duration));
        wave.once('ready', () => {
          if (current() === track) renderCardProgress(track, duration() ? currentTime() / duration() : 0);
        });
        cardWaves.set(track.id, wave);
      } catch (error) {
        console.warn(`Forma d'onda non disponibile per "${track.title}":`, error);
      }
    });
  }

  // --- Media Session (schermata di blocco, cuffie, tastiere multimediali) -------

  function setAction(action, handler) {
    if (!session) return;
    try {
      session.setActionHandler(action, handler);
    } catch {
      /* azione non supportata da questo browser */
    }
  }

  function updateMediaSession(track) {
    if (!session || typeof MediaMetadata === 'undefined') return;
    const artwork = track.cover
      ? [{ src: new URL(track.cover, document.baseURI).href, sizes: '600x600', type: imageType(track.cover) }]
      : [];
    session.metadata = new MediaMetadata({ title: track.title, artist: ARTIST_NAME, album: 'Mix', artwork });
  }

  function updatePositionState() {
    if (!session || !session.setPositionState || !current()) return;
    const total = duration();
    if (!total) return;
    try {
      session.setPositionState({
        duration: total,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(currentTime(), 0), total),
      });
    } catch {
      /* valori non accettati: si riprova al prossimo evento */
    }
  }

  setAction('play', play);
  setAction('pause', () => audio.pause());
  setAction('stop', () => {
    audio.pause();
    seek(0);
  });
  setAction('previoustrack', previous);
  setAction('nexttrack', next);
  setAction('seekto', (details) => {
    if (details.fastSeek && typeof audio.fastSeek === 'function' && audio.readyState >= HAVE_METADATA) {
      audio.fastSeek(details.seekTime);
    } else {
      seek(details.seekTime);
    }
  });

  // --- Eventi dell'elemento audio -------------------------------------------------

  audio.addEventListener('play', () => {
    startTicking();
    if (session) session.playbackState = 'playing';
    updatePositionState();
    notify();
  });
  audio.addEventListener('playing', () => {
    setBuffering(false);
    clearStatus('info');
    notify();
  });
  audio.addEventListener('waiting', () => {
    if (!audio.paused) setBuffering(true);
  });
  audio.addEventListener('pause', () => {
    setBuffering(false);
    stopTicking();
    if (session) session.playbackState = 'paused';
    updatePositionState();
    notify();
  });
  // A fine traccia il player si ferma: nessun passaggio automatico al mix successivo.
  audio.addEventListener('ended', () => {
    stopTicking();
    notify();
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      const target = pendingSeek;
      pendingSeek = null;
      if (Math.abs(audio.currentTime - target) > 0.5) audio.currentTime = target;
    }
    renderTime(currentTime(), true);
    updatePositionState();
  });
  audio.addEventListener('durationchange', () => renderTime(currentTime(), true));
  audio.addEventListener('seeked', () => {
    renderTime(currentTime(), true);
    updatePositionState();
  });
  // Con la scheda in background requestAnimationFrame è fermo: bastano questi
  audio.addEventListener('timeupdate', () => {
    if (!frame) renderTime(currentTime());
  });
  audio.addEventListener('error', () => {
    if (!audio.error || !audio.getAttribute('src')) return;
    setBuffering(false);
    stopTicking();
    // Firefox segnala così l'assenza di un dispositivo di uscita (es. cuffie scollegate)
    const noOutput = /sink/i.test(audio.error.message || '');
    const message = noOutput
      ? 'Nessuna uscita audio disponibile: controlla casse o cuffie.'
      : ERROR_MESSAGES[audio.error.code] || 'Impossibile riprodurre il mix.';
    setStatus(message, 'error');
    notify();
  });
  audio.addEventListener('volumechange', renderVolume);

  // --- Comandi ----------------------------------------------------------------------

  ui.artist.textContent = ARTIST_NAME;
  ui.toggle.addEventListener('click', toggle);
  ui.prev.addEventListener('click', previous);
  ui.next.addEventListener('click', next);

  ui.volume.addEventListener('input', () => {
    audio.volume = Number(ui.volume.value);
    audio.muted = audio.volume === 0;
    renderVolume();
  });
  ui.mute.addEventListener('click', () => {
    if (audio.muted || audio.volume === 0) {
      audio.muted = false;
      if (audio.volume === 0) audio.volume = 0.7;
    } else {
      audio.muted = true;
    }
    renderVolume();
  });

  // Forma d'onda della barra come slider: frecce ±5 s, Maiusc ±30 s, Pag ±60 s, Inizio/Fine
  ui.wave.addEventListener('keydown', (event) => {
    if (!current()) return;
    const step = event.shiftKey ? SEEK_STEP_LARGE : SEEK_STEP;
    let target;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        target = currentTime() - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        target = currentTime() + step;
        break;
      case 'PageDown':
        target = currentTime() - 60;
        break;
      case 'PageUp':
        target = currentTime() + 60;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = duration();
        break;
      default:
        return;
    }
    event.preventDefault();
    seek(target);
  });

  // Barra spaziatrice = play/pausa (se non è caricato nulla parte il mix più recente).
  // Non agisce su pulsanti e campi, dove lo spazio ha già un significato.
  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest(SPACE_IGNORED_ON)) return;
    if (!tracks.length) return;
    event.preventDefault();
    if (!event.repeat) toggle();
  });

  renderVolume();
  updateNavigation();

  api.toggleTrack = (id) => {
    const i = tracks.findIndex((track) => track.id === id);
    if (i === -1) return;
    if (i === index) toggle();
    else select(i);
  };

  function playAt(id, time) {
    const i = tracks.findIndex((track) => track.id === id);
    if (i === -1) return;
    if (i !== index) {
      select(i, { at: time });
      return;
    }
    seek(time);
    if (!isPlaying()) play();
  }

  api.playAt = playAt;
  api.mountWaveform = mountWaveform;
  return api;
}
