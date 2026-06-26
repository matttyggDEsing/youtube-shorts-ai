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
 * @param {string} text - Texto a narrar
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

  logger.step(`Generando narración con voz "${voice}"...`);

  try {
    const tts = new MsEdgeTTS();

    // Configurar voz con opciones de prosodia para narración dramática
    await tts.setMetadata(
      voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="es">
        <voice name="${voice}">
          <prosody rate="-5%" pitch="-5Hz">
            ${text}
          </prosody>
        </voice>
      </speak>`
    );

    // Generar audio y metadatos de palabras (para subtítulos)
    const { audioStream, wordBoundaryStream } = tts.toStream();

    // Guardar audio
    const audioWriteStream = fs.createWriteStream(audioPath);
    await new Promise((resolve, reject) => {
      audioStream.pipe(audioWriteStream);
      audioWriteStream.on('finish', resolve);
      audioWriteStream.on('error', reject);
      audioStream.on('error', reject);
    });

    // Recopilar word boundaries para VTT
    const wordBoundaries = [];
    await new Promise((resolve) => {
      wordBoundaryStream.on('data', (data) => wordBoundaries.push(data));
      wordBoundaryStream.on('end', resolve);
      wordBoundaryStream.on('error', () => resolve()); // no bloquear si falla
    });

    // Generar VTT desde word boundaries
    if (wordBoundaries.length > 0) {
      generateVttFromBoundaries(wordBoundaries, vttPath);
    } else {
      await generateBasicVtt(text, audioPath, vttPath);
    }

    const durationSeconds = await getAudioDuration(audioPath);
    logger.ok(`Narración generada: ${durationSeconds.toFixed(1)}s → ${path.basename(audioPath)}`);

    return { audioPath, vttPath, durationSeconds };

  } catch (error) {
    throw new Error(`Error en TTS: ${error.message}`);
  }
}

/**
 * Generar VTT desde word boundary events de msedge-tts
 * Cada evento tiene: { text, offset, duration } (offset en nanosegundos)
 */
function generateVttFromBoundaries(boundaries, vttPath) {
  const chunkSize = 5; // palabras por cue
  let vttContent = 'WEBVTT\n\n';
  let cueIndex = 1;

  for (let i = 0; i < boundaries.length; i += chunkSize) {
    const chunk = boundaries.slice(i, i + chunkSize);
    const startNs = chunk[0].offset;
    const lastItem = chunk[chunk.length - 1];
    const endNs = lastItem.offset + (lastItem.duration || 500_000_000); // fallback 0.5s

    // Convertir nanosegundos a segundos
    const startSec = startNs / 10_000_000;
    const endSec   = endNs   / 10_000_000;

    const words = chunk.map(b => b.text).join(' ');

    vttContent += `${cueIndex}\n`;
    vttContent += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n`;
    vttContent += `${words}\n\n`;
    cueIndex++;
  }

  fs.writeFileSync(vttPath, vttContent, 'utf8');
  logger.ok(`VTT generado desde word boundaries: ${cueIndex - 1} cues`);
}

/**
 * VTT básico si no hay word boundaries disponibles
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