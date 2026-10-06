// Configurazione del sito.

/**
 * Dove si trovano gli MP3.
 *  - ''  (vuoto)  → nella cartella audio/ del sito, es. su hosting Aruba.
 *  - un indirizzo → su uno storage esterno, es. Cloudflare R2 collegato a un
 *                   sottodominio: 'https://audio.tuodominio.it/'
 * Il nome del file viene dal campo "file" di data/tracks.json.
 */
export const AUDIO_BASE_URL = '';

/** Nome dell'artista nel player e nella schermata di blocco del telefono. */
export const ARTIST_NAME = 'Iacopo';
