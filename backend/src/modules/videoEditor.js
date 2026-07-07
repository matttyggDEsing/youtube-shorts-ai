// ════════════════════════════════════════
// VIDEO EDITOR v4 — Subtítulos ASS estilo CapCut / Captions AI
//                 + Mastering de audio (loudnorm/compresor)
//                 + Música de fondo con ducking automático
// parseVtt embebida · word-level highlight · borde negro grueso · sombra suave
// ════════════════════════════════════════

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { pickMusicTrack } from './musicSelector.js';

// ════════════════════════════════════════════════════════════
// PARSER VTT — embebido (parseVtt no era exportada por ttsNarrator.js)
// ════════════════════════════════════════════════════════════

/**
 * Convierte timestamp VTT "00:00:02.746" → segundos (float)
 */
function vttTimeToSeconds(ts) {
  const parts = ts.trim().split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600
      + parseFloat(parts[1]) * 60
      + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(parts[0]);
}

/**
 * Parsear un archivo .vtt → array de { start, end, text }
 */
function parseVtt(vttPath) {
  if (!fs.existsSync(vttPath)) {
    logger.warn(`VTT no encontrado: ${vttPath}`);
    return [];
  }

  const raw    = fs.readFileSync(vttPath, 'utf8');
  const cues   = [];
  const blocks = raw.split(/\n\s*\n/).filter(Boolean);

  for (const block of blocks) {
    const lines     = block.split('\n').map(l => l.trim()).filter(Boolean);
    const timingIdx = lines.findIndex(l => l.includes('-->'));
    if (timingIdx === -1) continue;

    const [startStr, endStr] = lines[timingIdx].split('-->');
    const start = vttTimeToSeconds(startStr);
    const end   = vttTimeToSeconds(endStr);
    const text  = lines.slice(timingIdx + 1).join(' ').trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

const execFileAsync = promisify(execFile);

const VIDEO_CONFIG = {
  width:        1080,
  height:       1920,
  fps:          30,
  videoBitrate: '4000k',
  audioBitrate: '192k',
  preset:       'fast',
  crf:          23,
  audioSampleRate: 44100,
  audioChannels:   2,
};

// ── Configuración de audio (mastering + música) ─────────────
const AUDIO_CONFIG = {
  // Masterización de la narración
  highpassHz:       80,     // corta rumble/graves sucios de la voz
  loudnormI:        -14,    // LUFS objetivo (estándar YouTube/redes)
  loudnormTP:       -1.5,   // true peak máximo (dBTP)
  loudnormLRA:      11,     // rango de loudness permitido
  fadeInSec:        0.05,   // fade-in cortito para evitar click al inicio

  // Música de fondo
  musicVolumeDb:    -24,    // volumen relativo de la música bajo la voz
  musicDuckingEnabled: true,
  musicFadeOutSec:  1.2,    // fade-out de la música al final del clip
};

// ── Configuración de subtítulos ─────────────────────────────
const SUB_CONFIG = {
  // Posición vertical: 88% de la altura (zona inferior segura en 9:16)
  marginVBottom: Math.round(1920 * 0.12),
  // Fuente — debe estar instalada en el sistema Windows.
  // Montserrat ExtraBold > Poppins Bold > Impact como fallback
  fontName: 'Montserrat',
  fontSize: 88,                 // px sobre 1080px de ancho (≈ ~8% altura)
  // Colores en formato ASS: &HAABBGGRR (alpha, blue, green, red)
  colorWhite:    '&H00FFFFFF',  // texto base
  colorHighlight:'&H0000FFFF',  // amarillo puro para la palabra activa
  colorBorder:   '&H00000000',  // negro
  colorShadow:   '&H88000000',  // negro semi-transparente
  borderWidth:   5,             // grosor del borde/outline
  shadowDepth:   3,             // desplazamiento de la sombra
  maxWordsPerLine: 4,           // máximo 4 palabras por cue
  minWordsPerLine: 2,           // mínimo 2 palabras por cue (excepto fin)
};

function getFfmpegPath() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function runFfmpegDirect(args, timeoutMs = 180000) {
  const bin = getFfmpegPath();
  try {
    await execFileAsync(bin, args, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(`FFmpeg error: ${err.stderr || err.message}`);
  }
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe error: ${err.message}`));
      resolve(metadata.format.duration || 0);
    });
  });
}

// ════════════════════════════════════════════════════════════
// CONFIG — leer sección "music" de config.json (opcional)
// ════════════════════════════════════════════════════════════

function readMusicSettings() {
  try {
    const raw = fs.readFileSync('./config.json', 'utf8');
    const cfg = JSON.parse(raw);
    return {
      enabled:        cfg.music?.enabled ?? true,
      volumeDb:       cfg.music?.volumeDb ?? AUDIO_CONFIG.musicVolumeDb,
      duckingEnabled: cfg.music?.duckingEnabled ?? AUDIO_CONFIG.musicDuckingEnabled,
    };
  } catch {
    return {
      enabled:        true,
      volumeDb:       AUDIO_CONFIG.musicVolumeDb,
      duckingEnabled: AUDIO_CONFIG.musicDuckingEnabled,
    };
  }
}

// ════════════════════════════════════════════════════════════
// GENERADOR DE SUBTÍTULOS ASS
// ════════════════════════════════════════════════════════════

/**
 * Convierte segundos a timestamp ASS: H:MM:SS.cc  (centésimas)
 */
function toAssTime(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Dividir el texto de un cue VTT en grupos de 2-4 palabras
 * respetando el reparto de tiempo proporcional entre palabras.
 *
 * Cada palabra recibe un slot de tiempo ∝ su longitud en caracteres,
 * que es la mejor aproximación cuando no tenemos timestamps word-level
 * desde el TTS (msedge-tts no exporta word timings en el VTT estándar).
 */
function splitCueIntoWordGroups(cue) {
  const words = cue.text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!words.length) return [];

  const totalDur   = cue.end - cue.start;
  const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;

  // Calcular el inicio de cada palabra proporcionalmente
  const wordTimings = [];
  let elapsed = 0;
  for (const word of words) {
    const wordDur = (word.length / totalChars) * totalDur;
    wordTimings.push({ word, start: cue.start + elapsed, dur: wordDur });
    elapsed += wordDur;
  }

  // Agrupar en chunks de maxWordsPerLine palabras
  const max   = SUB_CONFIG.maxWordsPerLine;
  const groups = [];
  for (let i = 0; i < wordTimings.length; i += max) {
    const chunk = wordTimings.slice(i, i + max);
    groups.push({
      words:   chunk,
      start:   chunk[0].start,
      end:     chunk[chunk.length - 1].start + chunk[chunk.length - 1].dur,
    });
  }

  return groups;
}

/**
 * Escapar caracteres especiales para ASS
 */
function escapeAss(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g,  '\\{')
    .replace(/\}/g,  '\\}')
    .replace(/\n/g,  '\\N');
}

/**
 * Construir una línea de diálogo ASS con karaoke word-highlight:
 * cada palabra individual cambia de color cuando llega su turno.
 *
 * Usamos el tag {\k<cs>} (karaoke timing) + override de color inline:
 *   {\c&H00FFFF00&}palabra{\c&H00FFFFFF&}
 *
 * La técnica: para cada palabra, generamos un evento ASS separado
 * que muestra TODA la línea pero con ESA palabra en color highlight.
 * Esto evita saltos de posición ya que la línea completa siempre ocupa
 * el mismo espacio.
 */
function buildAssDialogue(group) {
  const events   = [];
  const allWords = group.words.map(w => escapeAss(w.word));

  for (let i = 0; i < group.words.length; i++) {
    const wt     = group.words[i];
    const wStart = toAssTime(wt.start);
    const wEnd   = toAssTime(
      i < group.words.length - 1
        ? group.words[i + 1].start
        : group.end
    );

    const parts = allWords.map((w, idx) =>
      idx === i
        ? `{\\c${SUB_CONFIG.colorHighlight}&}${w}{\\c${SUB_CONFIG.colorWhite}&}`
        : w
    );

    events.push(`Dialogue: 0,${wStart},${wEnd},Default,,0,0,0,,${parts.join(' ')}`);
  }

  return events;
}

/**
 * Generar el header del archivo ASS con el estilo visual
 */
function buildAssHeader() {
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;
  const mb = SUB_CONFIG.marginVBottom;

  return `[Script Info]
Title: YouTube Shorts Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: ${W}
PlayResY: ${H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${SUB_CONFIG.fontName},${SUB_CONFIG.fontSize},${SUB_CONFIG.colorWhite},${SUB_CONFIG.colorHighlight},${SUB_CONFIG.colorBorder},${SUB_CONFIG.colorShadow},-1,0,0,0,100,100,0,0,1,${SUB_CONFIG.borderWidth},${SUB_CONFIG.shadowDepth},2,80,80,${mb},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Función principal: VTT → ASS profesional con word-level highlight
 * @param {string} vttPath  - Ruta al archivo .vtt generado por el TTS
 * @param {string} assPath  - Ruta de salida del .ass
 */
function buildAssFromVtt(vttPath, assPath) {
  const cues = parseVtt(vttPath);
  if (!cues.length) {
    logger.warn('VTT sin cues — archivo ASS vacío');
    fs.writeFileSync(assPath, buildAssHeader(), 'utf8');
    return 0;
  }

  const dialogueLines = [];

  for (const cue of cues) {
    // Dividir el cue en grupos de hasta maxWordsPerLine palabras
    const groups = splitCueIntoWordGroups(cue);

    for (const group of groups) {
      const events = buildAssDialogue(group);
      dialogueLines.push(...events);
    }
  }

  const content = buildAssHeader() + dialogueLines.join('\n') + '\n';
  fs.writeFileSync(assPath, content, 'utf8');
  logger.ok(`ASS generado: ${path.basename(assPath)} — ${dialogueLines.length} líneas`);
  return dialogueLines.length;
}

// ════════════════════════════════════════════════════════════
// PIPELINE DE VIDEO
// ════════════════════════════════════════════════════════════

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019")  // reemplazar comilla simple con typográfica (evita romper el argumento FFmpeg)
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/"/g, '\\"')
    .replace(/%/g, '\\%');
}

/**
 * PASO 0 — Masterizar el audio de la narración TTS.
 *
 * Antes solo se re-codificaba a 44100Hz estéreo. Ahora se aplica una
 * cadena de mastering pensada para voz narrada:
 *   1) highpass  → quita graves sucios / rumble de fondo del TTS
 *   2) acompressor → pareja los picos, la voz suena más consistente
 *      (menos partes "gritadas" y partes "susurradas")
 *   3) loudnorm  → normaliza a -14 LUFS (estándar YouTube/redes), así
 *      todos los Shorts suenan parejo entre sí sin importar la voz usada
 *   4) afade in  → evita el "click" audible al arrancar el audio
 */
async function normalizeAudio(inputAudioPath, tempDir) {
  logger.step('Masterizando audio de narración (limpieza + loudness)...');
  const normalizedPath = path.join(tempDir, 'narration_normalized.aac');

  const audioFilters = [
    `highpass=f=${AUDIO_CONFIG.highpassHz}`,
    'acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=2',
    `loudnorm=I=${AUDIO_CONFIG.loudnormI}:TP=${AUDIO_CONFIG.loudnormTP}:LRA=${AUDIO_CONFIG.loudnormLRA}`,
    `afade=t=in:st=0:d=${AUDIO_CONFIG.fadeInSec}`,
  ].join(',');

  await runFfmpegDirect([
    '-y',
    '-i', inputAudioPath,
    '-af', audioFilters,
    '-c:a', 'aac',
    '-b:a', VIDEO_CONFIG.audioBitrate,
    '-ar', String(VIDEO_CONFIG.audioSampleRate),
    '-ac', String(VIDEO_CONFIG.audioChannels),
    normalizedPath,
  ]);

  logger.ok('Audio masterizado (highpass + compresor + loudnorm)');
  return normalizedPath;
}

/**
 * PASO 0b — Mezclar la narración masterizada con música de fondo.
 *
 * Si no hay música disponible para la categoría (ni fallback "generic"),
 * se sigue solo con la narración sin romper el pipeline.
 *
 * Ducking automático: usamos sidechaincompress para que la propia
 * narración "empuje hacia abajo" el volumen de la música mientras se
 * habla, y la música suba un poco en los silencios — el mismo efecto
 * que se usa en podcasts/videos profesionales, en vez de dejar la
 * música siempre plana a un volumen fijo.
 */
async function mixWithBackgroundMusic(narrationPath, category, tempDir) {
  const settings = readMusicSettings();
  if (!settings.enabled) {
    logger.info('Música de fondo desactivada en config.json — se sigue solo con narración.');
    return narrationPath;
  }

  const musicPath = pickMusicTrack(category);
  if (!musicPath) {
    return narrationPath;
  }

  logger.step('Mezclando narración con música de fondo...');
  const mixedPath = path.join(tempDir, 'narration_with_music.aac');

  let narrationDur = 0;
  try { narrationDur = await getVideoDuration(narrationPath); } catch { /* noop */ }
  const totalDur = narrationDur > 0 ? narrationDur : 60;
  const fadeStart = Math.max(0, totalDur - AUDIO_CONFIG.musicFadeOutSec).toFixed(2);

  const musicPrep =
    `[1:a]aloop=loop=-1:size=2e9,` +
    `volume=${settings.volumeDb}dB,` +
    `atrim=0:${totalDur.toFixed(2)},` +
    `afade=t=out:st=${fadeStart}:d=${AUDIO_CONFIG.musicFadeOutSec}[musicraw]`;

  const filterComplex = settings.duckingEnabled
    ? `${musicPrep};[musicraw][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300:makeup=1[musicducked];` +
      `[0:a][musicducked]amix=inputs=2:duration=first:dropout_transition=0[audioFinal]`
    : `${musicPrep};[0:a][musicraw]amix=inputs=2:duration=first:dropout_transition=0[audioFinal]`;

  try {
    await runFfmpegDirect([
      '-y',
      '-i', narrationPath,
      '-i', musicPath,
      '-filter_complex', filterComplex,
      '-map', '[audioFinal]',
      '-c:a', 'aac',
      '-b:a', VIDEO_CONFIG.audioBitrate,
      '-ar', String(VIDEO_CONFIG.audioSampleRate),
      '-ac', String(VIDEO_CONFIG.audioChannels),
      mixedPath,
    ], 120000);

    logger.ok(`Música de fondo mezclada${settings.duckingEnabled ? ' (con ducking automático)' : ''}: ${path.basename(musicPath)}`);
    return mixedPath;
  } catch (error) {
    logger.warn(`No se pudo mezclar música de fondo: ${error.message}. Se continúa solo con narración.`);
    return narrationPath;
  }
}

/**
 * PASO 1 — Procesar cada clip raw de Pexels
 */
async function processClip(rawClipPath, clipDuration, outputPath, index) {
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;

  let sourceDuration = 5;
  try { sourceDuration = await getVideoDuration(rawClipPath); } catch { /* noop */ }

  const maxOffset = Math.max(0, sourceDuration - clipDuration - 0.5);
  const offset    = maxOffset > 0
    ? parseFloat((Math.random() * maxOffset * 0.6).toFixed(2))
    : 0;
  const dur = clipDuration.toFixed(3);

  const filters = [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    sourceDuration > 3 ? `setpts=1.15*PTS` : null,
    `curves=r='0/0 0.3/0.35 1/1':g='0/0 0.3/0.28 1/0.95':b='0/0 0.3/0.22 1/0.85'`,
    `eq=contrast=1.05:saturation=1.15:brightness=0.02`,
    `vignette=PI/4`,
    `fps=${VIDEO_CONFIG.fps}`,
  ].filter(Boolean).join(',');

  await runFfmpegDirect([
    '-y', '-ss', String(offset), '-i', rawClipPath,
    '-t', dur, '-vf', filters,
    '-c:v', 'libx264', '-preset', VIDEO_CONFIG.preset,
    '-crf', String(VIDEO_CONFIG.crf), '-pix_fmt', 'yuv420p',
    '-an', '-r', String(VIDEO_CONFIG.fps), outputPath,
  ]);

  logger.info(`Clip ${index + 1} procesado (${clipDuration}s desde ${offset}s)`);
}

/**
 * PASO 2 — Procesar todos los clips en lotes de 3
 */
async function processAllClips(rawClips, scenes, tempDir) {
  logger.step('Procesando clips con efectos cinematográficos...');
  const processedPaths = [];
  const BATCH_SIZE = 3;

  for (let i = 0; i < rawClips.length; i += BATCH_SIZE) {
    const batch = rawClips.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (clip, batchIndex) => {
      const globalIndex = i + batchIndex;
      if (!clip) { logger.warn(`Clip ${globalIndex + 1} ausente`); return null; }
      const outPath = path.join(tempDir, `clip_proc_${String(globalIndex + 1).padStart(3, '0')}.mp4`);
      try {
        await processClip(clip.path, clip.duration, outPath, globalIndex);
        return outPath;
      } catch (err) {
        logger.warn(`Error procesando clip ${globalIndex + 1}: ${err.message}`);
        return null;
      }
    });
    processedPaths.push(...(await Promise.all(promises)));
  }

  const validos = processedPaths.filter(Boolean);
  logger.ok(`${validos.length}/${rawClips.length} clips procesados`);
  return processedPaths;
}

/**
 * PASO 3 — Concatenar clips
 */
async function concatenateClips(processedPaths, tempDir) {
  logger.step('Concatenando clips...');

  const validPaths = processedPaths.filter(Boolean);
  if (!validPaths.length) throw new Error('No hay clips válidos para concatenar');

  const concatFile = path.resolve(tempDir, 'concat.txt');
  fs.writeFileSync(
    concatFile,
    validPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );

  const joinedPath = path.resolve(tempDir, 'joined.mp4');
  await runFfmpegDirect([
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatFile, '-c', 'copy', joinedPath,
  ]);

  logger.ok('Clips concatenados');
  return joinedPath;
}

/**
 * PASO 4 — Mezclar video con audio final (narración + música ya mezcladas)
 */
async function addAudio(videoPath, finalAudioPath, tempDir) {
  logger.step('Mezclando video con pista de audio final...');
  const withAudioPath = path.join(tempDir, 'with_audio.mp4');

  let videoDur = 0;
  let audioDur = 0;
  try { videoDur = await getVideoDuration(videoPath); } catch { /* noop */ }
  try { audioDur = await getVideoDuration(finalAudioPath); } catch { /* noop */ }

  logger.info(`Duración video: ${videoDur.toFixed(1)}s | audio: ${audioDur.toFixed(1)}s`);

  const baseArgs = [
    '-y',
    ...(videoDur > 0 && audioDur > 0 && videoDur < audioDur
      ? ['-stream_loop', '-1']
      : []),
    '-i', videoPath,
    '-i', finalAudioPath,
    '-c:v', 'copy', '-c:a', 'copy',
    '-shortest',
    '-map', '0:v:0', '-map', '1:a:0',
    withAudioPath,
  ];

  await runFfmpegDirect(baseArgs);
  logger.ok('Audio mezclado');
  return withAudioPath;
}

/**
 * PASO 5 — Subtítulos ASS estilo CapCut / viral
 *
 * Genera el .ass desde el VTT y lo quema con libass.
 * La fuente Montserrat debe estar instalada en el sistema.
 * Fallback automático a Arial Bold si no está disponible.
 */
async function addSubtitles(videoPath, vttPath, tempDir) {
  logger.step('Generando subtítulos ASS estilo CapCut...');

  const assPath     = path.join(tempDir, 'subtitles.ass');
  const withSubsPath = path.join(tempDir, 'with_subs.mp4');

  // Generar el .ass
  const lineCount = buildAssFromVtt(vttPath, assPath);
  if (!lineCount) {
    logger.warn('Sin subtítulos que agregar');
    return videoPath;
  }

  // En Windows, libass necesita la ruta con forward-slashes y sin ":"
  // Format para Windows: C\:/ruta/al/archivo.ass
  const assPathForFfmpeg = path.resolve(assPath)
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, '$1\\:');

  try {
    await runFfmpegDirect([
      '-y', '-i', videoPath,
      '-vf', `ass='${assPathForFfmpeg}'`,
      '-c:v', 'libx264',
      '-preset', VIDEO_CONFIG.preset,
      '-crf', String(VIDEO_CONFIG.crf),
      '-c:a', 'copy',
      withSubsPath,
    ], 300000);

    logger.ok(`Subtítulos ASS quemados (${lineCount} eventos)`);
    return withSubsPath;

  } catch (error) {
    logger.warn(`Error quemando ASS: ${error.message}`);
    logger.warn('Intentando fallback drawtext básico...');
    return addSubtitlesFallback(videoPath, vttPath, tempDir);
  }
}

/**
 * Fallback — drawtext mejorado (sin word-highlight, pero sí borde y sombra)
 * Se activa solo si libass falla (p.ej. FFmpeg sin soporte libass)
 */
async function addSubtitlesFallback(videoPath, vttPath, tempDir) {
  logger.step('Aplicando subtítulos drawtext (fallback)...');
  const vttCues = parseVtt(vttPath);
  if (!vttCues.length) return videoPath;

  const withSubsPath = path.join(tempDir, 'with_subs.mp4');
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;

  // Dividir cues en grupos de maxWordsPerLine palabras
  const shortCues = [];
  for (const cue of vttCues) {
    const words = cue.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const totalDur   = cue.end - cue.start;
    const totalChars = words.reduce((s, w) => s + w.length, 0) || 1;
    const max = SUB_CONFIG.maxWordsPerLine;

    for (let i = 0; i < words.length; i += max) {
      const chunk = words.slice(i, i + max);
      const charsInChunk = chunk.reduce((s, w) => s + w.length, 0);
      const chunkStart = cue.start
        + (words.slice(0, i).reduce((s, w) => s + w.length, 0) / totalChars) * totalDur;
      const chunkDur   = (charsInChunk / totalChars) * totalDur;
      shortCues.push({
        text:  chunk.join(' '),
        start: chunkStart,
        end:   chunkStart + chunkDur,
      });
    }
  }

  const vf = shortCues.map((cue) => {
    const txt    = escapeDrawtext(cue.text);
    const enable = `between(t\\,${cue.start.toFixed(3)}\\,${cue.end.toFixed(3)})`;
    const yPos   = `h*0.87`;
    return [
      `drawtext=text='${txt}'`,
      `enable='${enable}'`,
      `fontsize=${SUB_CONFIG.fontSize}`,
      `fontcolor=white`,
      `borderw=${SUB_CONFIG.borderWidth}`,
      `bordercolor=black`,
      `shadowx=${SUB_CONFIG.shadowDepth}`,
      `shadowy=${SUB_CONFIG.shadowDepth}`,
      `shadowcolor=black@0.6`,
      `x=(w-text_w)/2`,
      `y=${yPos}`,
      `fix_bounds=true`,
    ].join(':');
  }).join(',');

  try {
    await runFfmpegDirect([
      '-y', '-i', videoPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', VIDEO_CONFIG.preset,
      '-crf', String(VIDEO_CONFIG.crf),
      '-c:a', 'copy',
      withSubsPath,
    ], 300000);

    logger.ok(`Subtítulos drawtext (fallback) aplicados: ${shortCues.length} cues`);
    return withSubsPath;
  } catch (err) {
    logger.warn(`Fallback drawtext también falló: ${err.message}. Video sin subtítulos.`);
    return videoPath;
  }
}

/**
 * PASO 6a — Intro con título
 */
async function createIntro(title, tempDir) {
  logger.step(`Creando intro con título: "${title}"`);
  const introPath    = path.join(tempDir, 'intro.mp4');
  const duration     = 1.8;   // un poco más de tiempo para leer el título
  const W            = VIDEO_CONFIG.width;
  const H            = VIDEO_CONFIG.height;

  // Dividir título en dos líneas si supera 25 caracteres
  const MAX_LINE = 25;
  let line1 = title;
  let line2 = '';
  if (title.length > MAX_LINE) {
    const words = title.split(' ');
    const mid   = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(' ');
    line2 = words.slice(mid).join(' ');
  }

  const escaped1 = escapeDrawtext(line1.substring(0, 50));
  const escaped2 = line2 ? escapeDrawtext(line2.substring(0, 50)) : '';

  const fadeIn  = `if(lt(t\\,0.3)\\,t/0.3\\,if(lt(t\\,${duration - 0.3})\\,1\\,(${duration}-t)/0.3))`;

  // Si hay dos líneas, dibujar ambas centradas verticalmente
  const vfFilter = escaped2
    ? [
        `drawtext=text='${escaped1}':fontsize=72:fontcolor=white:borderw=4:bordercolor=black:shadowx=3:shadowy=3:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h/2)-80:alpha='${fadeIn}'`,
        `drawtext=text='${escaped2}':fontsize=72:fontcolor=white:borderw=4:bordercolor=black:shadowx=3:shadowy=3:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h/2)+10:alpha='${fadeIn}'`,
      ].join(',')
    : `drawtext=text='${escaped1}':fontsize=72:fontcolor=white:borderw=4:bordercolor=black:shadowx=3:shadowy=3:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h-text_h)/2:alpha='${fadeIn}'`;

  await runFfmpegDirect([
    '-y', '-f', 'lavfi',
    '-i', `color=c=0x0a0a0a:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', vfFilter,
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', VIDEO_CONFIG.preset,
    '-pix_fmt', 'yuv420p', '-r', String(VIDEO_CONFIG.fps),
    introPath,
  ]);

  logger.ok(`Intro creada: "${title}"`);
  return introPath;
}

/**
 * PASO 6b — Outro con call to action
 */
async function createOutro(channelName, tempDir) {
  logger.step('Creando outro...');
  const outroPath = path.join(tempDir, 'outro.mp4');
  const duration  = 2.5;
  const W         = VIDEO_CONFIG.width;
  const H         = VIDEO_CONFIG.height;
  const channel   = escapeDrawtext(channelName || 'Mi Canal');

  const vfFilter = [
    `drawtext=text='¿Querés saber qué pasó?':fontsize=58:fontcolor=white:borderw=3:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h/2)-120:alpha='if(lt(t\\,0.4)\\,t/0.4\\,1)'`,
    `drawtext=text='${channel}':fontsize=50:fontcolor=#FFD700:borderw=3:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h/2)-20:alpha='if(lt(t\\,0.5)\\,0\\,if(lt(t\\,0.9)\\,(t-0.5)/0.4\\,1))'`,
    `drawtext=text='Seguí para la Parte 2 👇':fontsize=46:fontcolor=#FF4444:borderw=3:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.7:x=(w-text_w)/2:y=(h/2)+80:alpha='if(lt(t\\,0.8)\\,0\\,if(lt(t\\,1.2)\\,(t-0.8)/0.4\\,1))'`,
  ].join(',');

  await runFfmpegDirect([
    '-y', '-f', 'lavfi',
    '-i', `color=c=0x0a0a0a:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', vfFilter,
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', VIDEO_CONFIG.preset,
    '-pix_fmt', 'yuv420p', '-r', String(VIDEO_CONFIG.fps),
    outroPath,
  ]);

  logger.ok('Outro creada');
  return outroPath;
}

/**
 * PASO 6c — Ensamblar intro + video + outro
 */
async function addIntroOutro(mainVideoPath, introPath, outroPath, tempDir) {
  logger.step('Ensamblando intro + video + outro...');

  const introWithAudio = path.join(tempDir, 'intro_audio.mp4');
  const outroWithAudio = path.join(tempDir, 'outro_audio.mp4');
  const anullsrc = `anullsrc=r=${VIDEO_CONFIG.audioSampleRate}:cl=stereo`;

  for (const [src, dst] of [[introPath, introWithAudio], [outroPath, outroWithAudio]]) {
    await runFfmpegDirect([
      '-y', '-i', src,
      '-f', 'lavfi', '-i', anullsrc,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', VIDEO_CONFIG.audioBitrate,
      '-ar', String(VIDEO_CONFIG.audioSampleRate),
      '-ac', String(VIDEO_CONFIG.audioChannels),
      '-shortest',
      '-map', '0:v', '-map', '1:a',
      dst,
    ]);
  }

  const finalConcatFile = path.resolve(tempDir, 'final_concat.txt');
  fs.writeFileSync(finalConcatFile, [
    `file '${path.resolve(introWithAudio).replace(/\\/g, '/')}'`,
    `file '${path.resolve(mainVideoPath).replace(/\\/g, '/')}'`,
    `file '${path.resolve(outroWithAudio).replace(/\\/g, '/')}'`,
  ].join('\n'), 'utf8');

  const assembledPath = path.join(tempDir, 'assembled.mp4');
  await runFfmpegDirect([
    '-y', '-f', 'concat', '-safe', '0',
    '-i', finalConcatFile, '-c', 'copy', assembledPath,
  ]);

  logger.ok('Ensamblado completo');
  return assembledPath;
}

/**
 * PASO 7 — Exportar video final
 */
async function exportFinal(inputPath, outputPath) {
  logger.step('Exportando video final...');

  await runFfmpegDirect([
    '-y', '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', VIDEO_CONFIG.preset,
    '-crf', String(VIDEO_CONFIG.crf),
    '-b:v', VIDEO_CONFIG.videoBitrate,
    '-c:a', 'aac',
    '-b:a', VIDEO_CONFIG.audioBitrate,
    '-ar', String(VIDEO_CONFIG.audioSampleRate),
    '-ac', String(VIDEO_CONFIG.audioChannels),
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_CONFIG.fps),
    '-metadata:s:v', 'rotate=0',
    outputPath,
  ], 300000);

  logger.ok(`Video final: ${path.basename(outputPath)}`);
}

// ════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ════════════════════════════════════════════════════════════

/**
 * @param {Array}  scenes      Escenas generadas por storyGenerator
 * @param {Array}  rawClips    Clips de B-roll descargados por videoFetcher
 * @param {string} audioPath   Ruta al mp3 de narración (TTS)
 * @param {string} vttPath     Ruta al .vtt de la narración
 * @param {string} outputPath  Ruta de salida del mp4 final
 * @param {string} title       Título del video (para el intro)
 * @param {string} category    Categoría de la historia (para elegir música de fondo)
 */
export async function createShort(scenes, rawClips, audioPath, vttPath, outputPath, title, category = 'terror') {
  const tempDir = path.resolve(path.dirname(audioPath));

  try {
    const normalizedAudio = await normalizeAudio(audioPath, tempDir);
    const finalAudio      = await mixWithBackgroundMusic(normalizedAudio, category, tempDir);

    const processedPaths  = await processAllClips(rawClips, scenes, tempDir);
    const joinedPath      = await concatenateClips(processedPaths, tempDir);
    const withAudioPath   = await addAudio(joinedPath, finalAudio, tempDir);
    const withSubsPath    = await addSubtitles(withAudioPath, vttPath, tempDir);

    const channelName   = process.env.CHANNEL_NAME || 'Mi Canal de Historias';
    const introPath     = await createIntro(title, tempDir);
    const outroPath     = await createOutro(channelName, tempDir);
    const assembledPath = await addIntroOutro(withSubsPath, introPath, outroPath, tempDir);

    await exportFinal(assembledPath, outputPath);
    return outputPath;

  } catch (error) {
    throw new Error(`Error en montaje de video: ${error.message}`);
  }
}
