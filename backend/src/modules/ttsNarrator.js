// ════════════════════════════════════════
// TTS NARRATOR — Narración con Microsoft Edge TTS (msedge-tts v2)
// Fix #3a: setMetadata NO acepta tercer argumento — eliminado { wordBoundaryEnabled }
// Fix #3b: duración calculada desde metadata cuando existe, no por tamaño de archivo
// ════════════════════════════════════════

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const VOCES_VALIDAS = [
  'es-AR-ElenaNeural',
  'es-MX-DaliaNeural',
  'es-ES-AlvaroNeural',
  'es-MX-JorgeNeural',
];

// ── Helpers de tiempo ────────────────────────────────────────

/** 100-nanosecond ticks → segundos */
function ticksToSeconds(ticks) {
  return ticks / 10_000_000;
}

/** Segundos → "HH:MM:SS.mmm" para VTT */
function formatVttTime(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ── Calcular duración real desde metadata ────────────────────

/**
 * Calcula la duración real del audio desde los word boundaries del metadata.
 * Toma el offset + duration del último item para obtener el fin real del audio.
 * Mucho más preciso que estimar por tamaño de archivo.
 */
function getDurationFromMetadata(metadataPath) {
  try {
    const raw   = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const items = (raw.Metadata || []).filter(
      m => m.Type === 'WordBoundary' && m.Data?.Offset !== undefined
    );
    if (!items.length) return null;

    const last = items[items.length - 1];
    const endTicks = last.Data.Offset + (last.Data.Duration || 0);
    const duration = ticksToSeconds(endTicks);

    // Agregar 300ms de margen al final para que el audio no se corte
    return duration + 0.3;
  } catch {
    return null;
  }
}

// ── Generadores de VTT ───────────────────────────────────────

/**
 * Construir VTT desde el metadata.json de msedge-tts.
 * Estructura del metadata:
 *   { Metadata: [ { Type: "WordBoundary", Data: { Offset, Duration, text: { Text, Length, BoundaryType } } } ] }
 * Offset y Duration están en ticks de 100ns.
 */
function buildVttFromMetadata(metadataPath, totalDuration, vttPath) {
  const raw   = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const items = (raw.Metadata || []).filter(
    m => m.Type === 'WordBoundary' && m.Data?.text?.Text?.trim()
  );

  if (!items.length) return false;

  const MAX_WORDS = 4;
  const lines     = ['WEBVTT', ''];
  let cueIndex    = 1;

  for (let i = 0; i < items.length; i += MAX_WORDS) {
    const chunk    = items.slice(i, i + MAX_WORDS);
    const start    = ticksToSeconds(chunk[0].Data.Offset);
    const nextItem = items[i + MAX_WORDS];
    const end      = nextItem
      ? ticksToSeconds(nextItem.Data.Offset)
      : Math.max(totalDuration, start + 0.1);

    const text = chunk.map(m => m.Data.text.Text.trim()).join(' ');

    lines.push(String(cueIndex++));
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(Math.min(end, totalDuration + 0.5))}`);
    lines.push(text);
    lines.push('');
  }

  fs.writeFileSync(vttPath, lines.join('\n'), 'utf8');
  logger.ok(`VTT generado desde metadata: ${cueIndex - 1} cues`);
  return true;
}

/**
 * Fallback VTT: distribuye el texto proporcionalmente al largo de cada palabra.
 * Se usa cuando no hay metadata de word-boundary.
 */
function buildVttFallback(text, totalDuration, vttPath) {
  const MAX_WORDS  = 4;
  const words      = text.trim().split(/\s+/).filter(Boolean);
  const totalChars = words.reduce((s, w) => s + w.length, 0) || 1;
  const lines      = ['WEBVTT', ''];
  let cueIndex     = 1;
  let elapsed      = 0;

  const wordTimings = words.map(word => {
    const start = elapsed;
    elapsed += (word.length / totalChars) * totalDuration;
    return { word, start };
  });

  for (let i = 0; i < wordTimings.length; i += MAX_WORDS) {
    const chunk = wordTimings.slice(i, i + MAX_WORDS);
    const start = chunk[0].start;
    const end   = wordTimings[i + MAX_WORDS]?.start ?? totalDuration;
    const text  = chunk.map(w => w.word).join(' ');

    lines.push(String(cueIndex++));
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    lines.push(text);
    lines.push('');
  }

  fs.writeFileSync(vttPath, lines.join('\n'), 'utf8');
  logger.ok(`VTT fallback generado: ${cueIndex - 1} cues`);
}

// ── Función principal ────────────────────────────────────────

/**
 * Genera narración TTS usando msedge-tts v2.
 *
 * @param {string} text        Texto completo a narrar
 * @param {string} outputBase  Ruta base sin extensión, p.ej. "./temp/xxx/narration"
 * @param {string} voice       ID de voz Edge TTS
 * @returns {{ audioPath, vttPath, durationSeconds }}
 */
export async function generateNarration(text, outputBase, voice = 'es-AR-ElenaNeural') {
  const selectedVoice = VOCES_VALIDAS.includes(voice) ? voice : 'es-AR-ElenaNeural';
  logger.step(`Generando narración TTS con voz "${selectedVoice}"...`);

  const outDir  = path.resolve(path.dirname(outputBase));
  const outName = path.basename(outputBase);

  // msedge-tts v2 guarda siempre como "audio.mp3" en el directorio dado.
  // Usamos un subdirectorio único para no colisionar entre llamadas.
  const ttsDir = path.join(outDir, outName + '_tts');
  fs.mkdirSync(ttsDir, { recursive: true });

  const tts = new MsEdgeTTS();

  // FIX #3a: setMetadata solo acepta 2 argumentos en msedge-tts v2.
  // El tercer argumento { wordBoundaryEnabled: true } era inválido y causaba
  // el error "tts.on is not a function" en versiones anteriores del código.
  await tts.setMetadata(
    selectedVoice,
    OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
  );

  // toFile() → { audioFilePath, metadataFilePath }
  const { audioFilePath, metadataFilePath } = await tts.toFile(ttsDir, text);

  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    throw new Error('msedge-tts no generó el archivo de audio');
  }

  // Mover audio al path esperado por el pipeline
  const finalAudioPath = `${path.join(outDir, outName)}.mp3`;
  fs.renameSync(audioFilePath, finalAudioPath);

  // FIX #3b: Calcular duración desde metadata (preciso) en lugar de por tamaño de archivo (inexacto).
  // Fallback: estimación por tamaño si no hay metadata disponible.
  let durationSeconds = null;

  if (metadataFilePath && fs.existsSync(metadataFilePath)) {
    durationSeconds = getDurationFromMetadata(metadataFilePath);
    if (durationSeconds) {
      logger.ok(`Duración calculada desde metadata: ${durationSeconds.toFixed(1)}s`);
    }
  }

  if (!durationSeconds) {
    // Fallback: MP3 96kbps mono → bytes / (96000/8) = bytes / 12000
    const audioStat = fs.statSync(finalAudioPath);
    durationSeconds = audioStat.size / 12000;
    logger.warn(`Duración estimada por tamaño de archivo: ${durationSeconds.toFixed(1)}s`);
  }

  const audioStat = fs.statSync(finalAudioPath);
  logger.ok(`Audio TTS: ${path.basename(finalAudioPath)} (~${durationSeconds.toFixed(1)}s, ${(audioStat.size / 1024).toFixed(0)} KB)`);

  // Generar VTT desde metadata si existe, si no fallback por estimación
  const finalVttPath = `${path.join(outDir, outName)}.vtt`;

  if (metadataFilePath && fs.existsSync(metadataFilePath)) {
    const ok = buildVttFromMetadata(metadataFilePath, durationSeconds, finalVttPath);
    if (!ok) {
      logger.warn('Metadata sin WordBoundary — usando VTT estimado');
      buildVttFallback(text, durationSeconds, finalVttPath);
    }
  } else {
    logger.warn('Sin metadata de word-boundary — usando VTT estimado');
    buildVttFallback(text, durationSeconds, finalVttPath);
  }

  // Limpiar subdirectorio temporal del TTS
  try { fs.rmSync(ttsDir, { recursive: true, force: true }); } catch { /* no crítico */ }

  return {
    audioPath:       finalAudioPath,
    vttPath:         finalVttPath,
    durationSeconds,
  };
}
