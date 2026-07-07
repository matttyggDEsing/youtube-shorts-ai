// ════════════════════════════════════════
// MUSIC SELECTOR — Elige un track de música de fondo por categoría
// Carpeta: backend/assets/music/<categoria>/*.mp3
// Fallback: backend/assets/music/generic/*.mp3
// ════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const MUSIC_ROOT = path.resolve('./assets/music');
const AUDIO_EXT   = ['.mp3', '.m4a', '.aac', '.wav'];

function listAudioFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(
    (f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())
  );
}

/**
 * Elige un archivo de música aleatorio para la categoría dada.
 * Si la carpeta de la categoría no tiene archivos, cae en "generic".
 * Si tampoco hay nada ahí, devuelve null (el pipeline sigue sin música).
 *
 * @param {string} category
 * @returns {string|null} ruta absoluta al archivo elegido, o null
 */
export function pickMusicTrack(category) {
  const candidateDirs = [
    path.join(MUSIC_ROOT, category),
    path.join(MUSIC_ROOT, 'generic'),
  ];

  for (const dir of candidateDirs) {
    const files = listAudioFiles(dir);
    if (files.length) {
      const chosen = files[Math.floor(Math.random() * files.length)];
      const fullPath = path.join(dir, chosen);
      logger.info(`Música de fondo elegida: ${path.relative(MUSIC_ROOT, fullPath)}`);
      return fullPath;
    }
  }

  logger.warn(
    `Sin música de fondo disponible para "${category}" (ni en "generic"). ` +
    `Colocá archivos .mp3 en assets/music/${category}/ o assets/music/generic/. ` +
    `Se genera el video solo con narración.`
  );
  return null;
}

/**
 * Devuelve un resumen de qué categorías tienen música cargada (útil para
 * mostrar en el frontend o loguear al arrancar el server).
 */
export function getMusicLibraryStatus() {
  if (!fs.existsSync(MUSIC_ROOT)) return {};
  const categories = fs.readdirSync(MUSIC_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const status = {};
  for (const cat of categories) {
    status[cat] = listAudioFiles(path.join(MUSIC_ROOT, cat)).length;
  }
  return status;
}
