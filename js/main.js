// Rendering di mix ed eventi da data/tracks.json e data/events.json,
// collegamento delle card al player e piccoli dettagli dell'interfaccia.

import { createPlayer, formatTime } from './player.js';
import { createAnimation } from './anim.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const longDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const fullDate = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short' });
const shortWeekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });

document.documentElement.classList.add('js');

// --- Utilità --------------------------------------------------------------------

// "AAAA-MM-GG" → mezzanotte locale (new Date("AAAA-MM-GG") userebbe il fuso UTC)
function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function todayISO() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function loadJSON(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const whenIdle = (callback) =>
  'requestIdleCallback' in window ? window.requestIdleCallback(callback, { timeout: 1500 }) : setTimeout(callback, 200);

// --- Comparsa allo scroll ----------------------------------------------------------

const revealObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-in');
            revealObserver.unobserve(entry.target);
          });
        },
        { rootMargin: '0px 0px -8% 0px' },
      )
    : null;

function observeReveal(root = document) {
  root.querySelectorAll('.reveal:not(.is-in)').forEach((element) => {
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('is-in');
  });
}

// --- Header, hero, footer -----------------------------------------------------------

function setupHeader() {
  const header = document.querySelector('[data-header]');
  let queued = false;
  const update = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
    queued = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
}

// Logo animato: si carica dopo la pagina, quando il browser è libero, e si
// ferma quando la hero non è visibile.
function setupHeroLogo() {
  const container = document.querySelector('[data-hero-logo]');
  if (!container) return;
  const start = () => {
    const logo = createAnimation(container, 'assets/lottie/logo.json', { restFrame: 20 });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => (entry.isIntersecting ? logo.play() : logo.pause())).observe(container);
    }
  };
  if (document.readyState === 'complete') whenIdle(start);
  else window.addEventListener('load', () => whenIdle(start), { once: true });
}

function setYear() {
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
}

// --- Mix -------------------------------------------------------------------------------

function cleanTracks(data) {
  if (!Array.isArray(data)) throw new Error('data/tracks.json deve contenere un array');
  const ids = new Set();
  const tracks = [];
  data.forEach((item, position) => {
    const valid =
      item &&
      typeof item.id === 'string' &&
      item.id.trim() &&
      typeof item.title === 'string' &&
      ISO_DATE.test(item.date) &&
      Number(item.duration) > 0 &&
      typeof item.file === 'string' &&
      item.file.trim();
    if (!valid || ids.has(item.id)) {
      console.warn('Traccia ignorata (campi mancanti o id ripetuto):', item);
      return;
    }
    ids.add(item.id);
    tracks.push({ ...item, duration: Number(item.duration), position });
  });
  // Dalla più recente; a parità di data vale l'ordine del file
  return tracks.sort((a, b) => b.date.localeCompare(a.date) || a.position - b.position);
}

function renderTracks(tracks, player) {
  const list = document.querySelector('[data-tracks]');
  const template = document.getElementById('track-template');
  const cards = new Map();

  tracks.forEach((track, i) => {
    const item = template.content.firstElementChild.cloneNode(true);
    const card = item.querySelector('.track');
    card.dataset.trackId = track.id;
    item.style.setProperty('--delay', `${Math.min(i, 3) * 70}ms`);

    const cover = card.querySelector('.track__cover img');
    if (track.cover) cover.src = track.cover;
    else cover.remove();

    card.querySelector('.track__name').textContent = track.title;
    const date = card.querySelector('.track__meta time');
    date.dateTime = track.date;
    date.textContent = longDate.format(parseDate(track.date));
    card.querySelector('.track__duration').textContent = formatTime(track.duration);

    const button = card.querySelector('.track__play');
    button.setAttribute('aria-label', `Riproduci ${track.title}`);
    button.addEventListener('click', () => player.toggleTrack(track.id));

    const description = card.querySelector('.track__desc');
    if (track.description) description.textContent = track.description;
    else description.remove();

    const details = card.querySelector('.tracklist');
    const lines = Array.isArray(track.tracklist)
      ? track.tracklist.filter((line) => typeof line === 'string' && line.trim())
      : [];
    if (lines.length) {
      details.querySelector('summary').textContent = `Tracklist · ${lines.length} ${lines.length === 1 ? 'brano' : 'brani'}`;
      const ol = details.querySelector('ol');
      lines.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        ol.append(li);
      });
    } else {
      details.remove();
    }

    if (track.description || lines.length) card.classList.add('has-extra');
    else card.querySelector('.track__extra').remove();

    cards.set(track.id, card);
    list.append(item);
  });

  return cards;
}

// Le forme d'onda delle card si creano solo quando la card si avvicina allo schermo.
function observeWaveforms(tracks, cards, player) {
  const mount = (track) => player.mountWaveform(track, cards.get(track.id).querySelector('.track__wave'));
  if (!('IntersectionObserver' in window)) {
    tracks.forEach(mount);
    return;
  }
  const byCard = new Map(tracks.map((track) => [cards.get(track.id), track]));
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        mount(byCard.get(entry.target));
      });
    },
    { rootMargin: '300px 0px' },
  );
  byCard.forEach((track, card) => observer.observe(card));
}

// Un solo equalizzatore Lottie, spostato sulla card in riproduzione.
const equalizer = { element: null, animation: null };

function updateEqualizer(cards, { trackId, playing }) {
  const card = cards.get(trackId);
  if (!card) return;
  if (!equalizer.element) {
    equalizer.element = document.createElement('span');
    equalizer.element.className = 'eq lottie-tint';
  }
  const slot = card.querySelector('.track__now');
  if (equalizer.element.parentNode !== slot) slot.append(equalizer.element);
  if (!equalizer.animation && playing) {
    equalizer.animation = createAnimation(equalizer.element, 'assets/lottie/equalizer.json', { restFrame: 8 });
  }
  if (equalizer.animation) {
    if (playing) equalizer.animation.play();
    else equalizer.animation.pause();
  }
}

function syncCards(cards, { trackId, playing }) {
  cards.forEach((card, id) => {
    const active = id === trackId;
    const button = card.querySelector('.track__play');
    const title = card.querySelector('.track__name').textContent;
    card.classList.toggle('is-active', active);
    button.classList.toggle('is-playing', active && playing);
    button.setAttribute('aria-label', `${active && playing ? 'Metti in pausa' : 'Riproduci'} ${title}`);
  });
}

function setupLatestButton(tracks, player) {
  const button = document.querySelector('[data-play-latest]');
  if (!button || !tracks.length) return () => {};
  const label = button.querySelector('span');
  button.hidden = false;
  button.addEventListener('click', () => player.toggleTrack(tracks[0].id));
  return ({ trackId, playing }) => {
    const active = trackId === tracks[0].id && playing;
    button.classList.toggle('is-playing', active);
    label.textContent = active ? 'Pausa' : "Ascolta l'ultimo mix";
  };
}

// --- Date -------------------------------------------------------------------------------

function renderEvents(data) {
  const list = document.querySelector('[data-events]');
  const empty = document.querySelector('[data-events-empty]');
  const template = document.getElementById('event-template');
  const today = todayISO();
  const thisYear = new Date().getFullYear();

  // Le date passate spariscono da sole; quelle di oggi restano fino a mezzanotte.
  const upcoming = (Array.isArray(data) ? data : [])
    .filter((event) => event && ISO_DATE.test(event.date) && typeof event.venue === 'string' && event.venue.trim())
    .filter((event) => event.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!upcoming.length) {
    empty.hidden = false;
    return;
  }

  upcoming.forEach((event, i) => {
    const item = template.content.firstElementChild.cloneNode(true);
    const date = parseDate(event.date);
    item.style.setProperty('--delay', `${Math.min(i, 3) * 70}ms`);

    const time = item.querySelector('.event__date');
    time.dateTime = event.date;
    item.querySelector('.event__day').textContent = String(date.getDate());
    const month = shortMonth.format(date).replace('.', '');
    item.querySelector('.event__month').textContent =
      date.getFullYear() === thisYear ? `${month} · ${shortWeekday.format(date).replace('.', '')}` : `${month} ${date.getFullYear()}`;
    item.querySelector('.visually-hidden').textContent = fullDate.format(date);

    item.querySelector('.event__venue').textContent = event.venue;
    const city = item.querySelector('.event__city');
    if (event.city) city.textContent = event.city;
    else city.remove();

    const link = item.querySelector('.event__link');
    if (isWebUrl(event.link)) {
      link.href = event.link;
      link.setAttribute('aria-label', `Info su ${event.venue}${event.city ? `, ${event.city}` : ''} (si apre in una nuova scheda)`);
    } else {
      link.remove();
    }

    list.append(item);
  });
}

// --- Avvio ------------------------------------------------------------------------------

async function main() {
  setupHeader();
  setupHeroLogo();
  setYear();
  observeReveal();

  const [tracksResult, eventsResult] = await Promise.allSettled([
    loadJSON('data/tracks.json'),
    loadJSON('data/events.json'),
  ]);

  if (eventsResult.status === 'rejected') console.warn('Date non disponibili:', eventsResult.reason);
  renderEvents(eventsResult.status === 'fulfilled' ? eventsResult.value : []);

  let tracks = [];
  let failed = tracksResult.status === 'rejected';
  if (!failed) {
    try {
      tracks = cleanTracks(tracksResult.value);
    } catch (error) {
      console.warn(error);
      failed = true;
    }
  } else {
    console.warn('Mix non disponibili:', tracksResult.reason);
  }

  const notice = document.querySelector('[data-tracks-notice]');
  if (failed) {
    notice.textContent = 'Impossibile caricare i mix in questo momento. Riprova tra poco.';
    notice.hidden = false;
  } else if (!tracks.length) {
    notice.textContent = 'Nessun mix pubblicato, per ora.';
    notice.hidden = false;
  }

  if (tracks.length) {
    const player = createPlayer(document.querySelector('[data-player]'), tracks);
    const cards = renderTracks(tracks, player);
    document.querySelector('[data-mix-count]').textContent = `${tracks.length} mix`;
    observeWaveforms(tracks, cards, player);
    const updateLatest = setupLatestButton(tracks, player);
    player.addEventListener('change', ({ detail }) => {
      syncCards(cards, detail);
      updateEqualizer(cards, detail);
      updateLatest(detail);
    });
  }

  observeReveal();
}

main();
