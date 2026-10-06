// Animazioni Lottie: la libreria (build "light", solo renderer SVG) si scarica
// solo al primo utilizzo e le animazioni restano ferme su un fotogramma se il
// sistema chiede di ridurre il movimento.

const LIBRARY_URL = new URL('./vendor/lottie_light-5.13.0.min.js', import.meta.url).href;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animations = new Set();
let library = null;

function loadLibrary() {
  if (!library) {
    library = new Promise((resolve, reject) => {
      if (window.lottie) {
        resolve(window.lottie);
        return;
      }
      const script = document.createElement('script');
      script.src = LIBRARY_URL;
      script.async = true;
      script.onload = () => (window.lottie ? resolve(window.lottie) : reject(new Error('lottie-web non disponibile')));
      script.onerror = () => {
        library = null;
        reject(new Error('Impossibile caricare lottie-web'));
      };
      document.head.append(script);
    });
  }
  return library;
}

export function prefersReducedMotion() {
  return reducedMotion.matches;
}

/**
 * Monta un'animazione Lottie nel contenitore e restituisce un controller con
 * play() e pause(). Le chiamate fatte prima che l'animazione sia pronta valgono
 * comunque: si applicano appena il file è caricato.
 *
 * restFrame è il fotogramma mostrato quando il movimento è ridotto.
 */
export function createAnimation(container, path, { loop = true, autoplay = true, restFrame = 0 } = {}) {
  let animation = null;
  let loaded = false;
  let wantsPlay = autoplay;

  const controller = {
    play() {
      wantsPlay = true;
      sync();
    },
    pause() {
      wantsPlay = false;
      sync();
    },
    sync,
  };

  function sync() {
    if (!loaded) return;
    if (reducedMotion.matches) animation.goToAndStop(restFrame, true);
    else if (wantsPlay) animation.play();
    else animation.pause();
  }

  loadLibrary()
    .then((lottie) => {
      animation = lottie.loadAnimation({
        container,
        path,
        renderer: 'svg',
        loop,
        autoplay: false,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      });
      animation.addEventListener('DOMLoaded', () => {
        loaded = true;
        animations.add(controller);
        sync();
      });
      animation.addEventListener('data_failed', () => console.warn(`Animazione non trovata: ${path}`));
    })
    .catch((error) => console.warn(error.message));

  return controller;
}

function onMotionPreferenceChange() {
  animations.forEach((controller) => controller.sync());
}

if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionPreferenceChange);
else reducedMotion.addListener(onMotionPreferenceChange);
