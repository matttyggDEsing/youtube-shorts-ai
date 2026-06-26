// ════════════════════════════════════════
// TTS NARRATOR — Narración con msedge-tts
// ════════════════════════════════════════

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

// Voces disponibles en español
export const VOCES_DISPONIBLES = {
  'es-AR-ElenaNeural':  { nombre: 'Elena (Argentina, Femenina)',  genero: 'F', acento: 'Argentina' },
  'es-MX-DaliaNeural':  { nombre: 'Dalia (México, Femenina)',     genero: 'F', acento: 'México' },
  'es-ES-AlvaroNeural': { nombre: 'Álvaro (España, Masculino)',   genero: 'M', acento: 'España' },
  'es-MX-JorgeNeural':  { nombre: 'Jorge (México, Masculino)',    genero: 'M', acento: 'México' },
};

/**
 * Obtener duración de un archivo de audio con ffprobe
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe error: ${err.message}`));
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Generar narración de texto a voz con msedge-tts
 * @param {string} text - Texto a narrar (texto plano, sin SSML)
 * @param {string} outputPath - Ruta base donde guardar (sin extensión)
 * @param {string} voice - Nombre de la voz (ej: "es-AR-ElenaNeural")
 * @returns {Promise<{audioPath, vttPath, durationSeconds}>}
 */
export async function generateNarration(text, outputPath, voice = 'es-AR-ElenaNeural') {
  if (!VOCES_DISPONIBLES[voice]) {
    logger.warn(`Voz "${voice}" no reconocida, usando es-AR-ElenaNeural`);
    voice = 'es-AR-ElenaNeural';
  }

  const audioPath = `${outputPath}.mp3`;
  const vttPath   = `${outputPath}.vtt`;
  const outputDir = path.dirname(outputPath);
  const outputFilename = path.basename(outputPath);

  logger.step(`Generando narración con voz "${voice}"...`);

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // Usar texto plano — toFile con SSML no devuelve datos en esta versión
    const { audioFilePath } = await tts.toFile(outputDir, text, outputFilename);

    // Renombrar si el path devuelto no coincide con el esperado
    const resolvedAudio = audioFilePath ?? path.join(outputDir, outputFilename + '.mp3');
    if (resolvedAudio !== audioPath && fs.existsSync(resolvedAudio)) {
      fs.renameSync(resolvedAudio, audioPath);
    }

    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      throw new Error('El archivo de audio generado está vacío o no existe');
    }

    logger.ok(`Audio guardado: ${path.basename(audioPath)} (${fs.statSync(audioPath).size} bytes)`);

    // Generar VTT por duración
    await generateBasicVtt(text, audioPath, vttPath);

    const durationSeconds = await getAudioDuration(audioPath);
    logger.ok(`Narración generada: ${durationSeconds.toFixed(1)}s → ${path.basename(audioPath)}`);

    return { audioPath, vttPath, durationSeconds };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error en TTS: ${msg}`);
  }
}

/**
 * VTT básico calculando tiempos por duración del audio
 */
async function generateBasicVtt(text, audioPath, vttPath) {
  try {
    const duration = await getAudioDuration(audioPath);
    const words = text.split(/\s+/).filter(Boolean);
    const wordsPerSecond = words.length / duration;
    const chunkSize = 6;

    let vttContent = 'WEBVTT\n\n';
    let wordIndex = 0;
    let cueIndex = 1;

    while (wordIndex < words.length) {
      const chunk = words.slice(wordIndex, wordIndex + chunkSize);
      const startSec = wordIndex / wordsPerSecond;
      const endSec   = Math.min((wordIndex + chunkSize) / wordsPerSecond, duration);

      vttContent += `${cueIndex}\n`;
      vttContent += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n`;
      vttContent += `${chunk.join(' ')}\n\n`;

      wordIndex += chunkSize;
      cueIndex++;
    }

    fs.writeFileSync(vttPath, vttContent, 'utf8');
    logger.ok(`VTT básico generado: ${cueIndex - 1} cues`);
  } catch {
    fs.writeFileSync(vttPath, 'WEBVTT\n\n', 'utf8');
  }
}

/** Formatear segundos a HH:MM:SS.mmm */
function formatVttTime(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

/** Parsear VTT → array de cues para el editor de video */
export function parseVtt(vttPath) {
  try {
    const content = fs.readFileSync(vttPath, 'utf8');
    const cues = [];
    const cueRegex = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*\n([\s\S]*?)(?=\n\n|\n?$)/gm;
    let match;
    while ((match = cueRegex.exec(content)) !== null) {
      cues.push({
        start: parseVttTime(match[1]),
        end:   parseVttTime(match[2]),
        text:  match[3].replace(/<[^>]+>/g, '').trim(),
      });
    }
    return cues;
  } catch {
    return [];
  }
}

function parseVttTime(timeStr) {
  const parts = timeStr.replace(',', '.').split(':');
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}
