// ════════════════════════════════════════
// LIVE STREAM MANAGER
// Orquesta el directo completo:
//   1. Genera título, descripción, tags y thumbnail
//   2. Crea el broadcast en YouTube
//   3. Selecciona audio y fondo
//   4. Streama con FFmpeg vía RTMP
//   5. Gestiona el loop de contenido en vivo
// ════════════════════════════════════════

import { execFile, spawn }     from 'child_process';
import { promisify }           from 'util';
import path                    from 'path';
import fs                      from 'fs';
import { v4 as uuidv4 }        from 'uuid';
import { logger }              from '../../utils/logger.js';
import { generateLiveTitle }   from './liveTitleGenerator.js';
import { generateLiveDescription } from './liveDescriptionGenerator.js';
import { generateLiveTags }    from './liveTagsGenerator.js';
import { generateLiveThumbnail } from './liveThumbnailGenerator.js';
import { selectBackground }    from './liveBackgroundGenerator.js';
import { selectAudio, AUDIO_MIX_VOLUME } from './liveAudioGenerator.js';
import {
  createLiveBroadcast,
  uploadLiveThumbnail,
  updateBroadcastTags,
  endLiveBroadcast,
  pinComment,
  hasValidToken,
} from './liveUploader.js';
import {
  categoryNeedsNarration,
  prefetchContentBlocks,
} from './liveSceneManager.js';

const execFileAsync = promisify(execFile);

// Estado global del stream (un único directo a la vez)
let streamState = {
  running:     false,
  broadcastId: null,
  ffmpegProc:  null,
  category:    null,
  startedAt:   null,
  errors:      0,
};

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicia un directo completo de forma automatizada.
 *
 * @param {object} options
 * @param {string}  options.category        - Categoría del directo
 * @param {string}  [options.voice]         - Voz TTS
 * @param {number}  [options.durationHours] - Duración del directo en horas
 * @param {string}  [options.privacyStatus] - 'public' | 'unlisted' | 'private'
 * @param {boolean} [options.enableDvr]
 * @param {boolean} [options.recordFromStart]
 * @param {boolean} [options.pinnedComment]
 * @returns {Promise<{ broadcastId: string, url: string }>}
 */
export async function startLiveStream({
  category        = 'musica_estudiar',
  voice           = 'es-MX-DaliaNeural',
  durationHours   = 8,
  privacyStatus   = 'public',
  enableDvr       = true,
  recordFromStart = true,
  pinnedComment   = true,
}) {
  if (streamState.running) {
    throw new Error('Ya hay un directo activo. Detenerlo antes de iniciar otro.');
  }
  if (!hasValidToken()) {
    throw new Error('No hay token de YouTube. Autorizá la app desde /api/youtube/auth.');
  }

  const durationSecs = durationHours * 3600;
  const sessionId    = uuidv4();
  const tempDir      = path.join(process.cwd(), 'temp', `live_${sessionId}`);
  fs.mkdirSync(tempDir, { recursive: true });

  logger.ok(`LiveStreamManager: iniciando directo de "${category}"...`);

  // ── Paso 1: Generar metadatos ────────────────────────────────────────────
  logger.step('Generando título, descripción y tags...');
 const [titleRaw, description, tags] = await Promise.all([
  generateLiveTitle(category),
  generateLiveDescription(category),
  generateLiveTags(category, ''),
]);

// generateLiveTitle puede devolver varios separados por coma — tomar solo el primero
const title = Array.isArray(titleRaw)
  ? titleRaw[0]
  : String(titleRaw).split(',')[0].trim();

  // Regenerar tags con título real
  const tagsWithTitle = await generateLiveTags(category, title);

  logger.ok(`Título: ${title}`);

  // ── Paso 2: Crear broadcast en YouTube ───────────────────────────────────
  logger.step('Creando broadcast en YouTube...');
  const { broadcastId, rtmpUrl, streamKey } = await createLiveBroadcast({
    title,
    description,
    scheduledStart: new Date().toISOString(),
    privacyStatus,
    enableDvr,
    recordFromStart,
  });

  const youtubeUrl = `https://www.youtube.com/watch?v=${broadcastId}`;
  logger.ok(`Broadcast: ${youtubeUrl}`);

  // ── Paso 3: Thumbnail ────────────────────────────────────────────────────
  logger.step('Generando thumbnail...');
  try {
    const thumbDir  = process.env.LIVE_THUMBNAILS_DIR
      || path.join(process.cwd(), 'output', 'live_thumbnails');
    const thumbPath = path.join(thumbDir, `${broadcastId}.png`);

    await generateLiveThumbnail({ title, category, outputPath: thumbPath });
    await uploadLiveThumbnail(broadcastId, thumbPath);
    await updateBroadcastTags(broadcastId, tagsWithTitle);
  } catch (err) {
    logger.warn(`Thumbnail/tags no aplicados (no crítico): ${err.message}`);
  }

  // ── Paso 4: Comentario fijado ────────────────────────────────────────────
  if (pinnedComment) {
    try {
      const commentText = buildPinnedComment(category, title);
      await pinComment(broadcastId, commentText);
    } catch (err) {
      logger.warn(`Pin comment falló (no crítico): ${err.message}`);
    }
  }

  // ── Paso 5: Seleccionar audio y fondo ────────────────────────────────────
  logger.step('Seleccionando fondo y audio...');
  const [backgroundPath, audioResult] = await Promise.all([
    selectBackground(category, durationSecs, tempDir),
    selectAudio(category, durationSecs, tempDir),
  ]);

  const { audioPath, volume } = audioResult;

  // ── Paso 6: Pre-generar bloques de contenido (si aplica) ─────────────────
  let contentBlocks = [];
  if (categoryNeedsNarration(category)) {
    logger.step('Generando primer lote de contenido narrativo...');
    contentBlocks = await prefetchContentBlocks({
      category,
      voice,
      outputDir: path.join(tempDir, 'content'),
      startIndex: 0,
      count: 3,
    });
    logger.ok(`${contentBlocks.length} bloques de contenido generados.`);
  }

  // ── Paso 7: Iniciar FFmpeg RTMP ──────────────────────────────────────────
  logger.step('Iniciando transmisión FFmpeg...');
  const rtmpTarget = `${rtmpUrl}/${streamKey}`;

  const ffmpegProc = spawnFFmpegRTMP({
    backgroundPath,
    audioPath,
    audioVolume: volume,
    rtmpTarget,
    durationSecs,
    contentBlocks,
  });

  // Actualizar estado global
  streamState = {
    running:     true,
    broadcastId,
    ffmpegProc,
    category,
    startedAt:   new Date().toISOString(),
    errors:      0,
    sessionId,
    tempDir,
  };

  // Cleanup al terminar FFmpeg
  ffmpegProc.on('close', (code) => {
    logger.info(`FFmpeg terminó con código ${code}`);
    streamState.running    = false;
    streamState.ffmpegProc = null;

    // Finalizar el broadcast en YouTube
    endLiveBroadcast(broadcastId).catch(err =>
      logger.warn(`No se pudo finalizar broadcast: ${err.message}`)
    );

    // Limpiar temp
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  logger.ok(`Directo activo: ${youtubeUrl}`);
  return { broadcastId, url: youtubeUrl };
}

/**
 * Detiene el directo actual.
 */
export async function stopLiveStream() {
  if (!streamState.running) {
    throw new Error('No hay directo activo.');
  }

  logger.step('Deteniendo directo...');

  // Matar FFmpeg
  if (streamState.ffmpegProc) {
    streamState.ffmpegProc.kill('SIGTERM');
  }

  // Finalizar broadcast en YouTube
  if (streamState.broadcastId) {
    try {
      await endLiveBroadcast(streamState.broadcastId);
    } catch (err) {
      logger.warn(`Error finalizando broadcast: ${err.message}`);
    }
  }

  const url = streamState.broadcastId
    ? `https://www.youtube.com/watch?v=${streamState.broadcastId}`
    : null;

  streamState = {
    running: false, broadcastId: null, ffmpegProc: null,
    category: null, startedAt: null,  errors: 0,
  };

  logger.ok('Directo detenido.');
  return { url };
}

/**
 * Devuelve el estado actual del stream.
 */
export function getLiveStreamStatus() {
  return {
    running:     streamState.running,
    broadcastId: streamState.broadcastId,
    category:    streamState.category,
    startedAt:   streamState.startedAt,
    errors:      streamState.errors,
    url: streamState.broadcastId
      ? `https://www.youtube.com/watch?v=${streamState.broadcastId}`
      : null,
  };
}

// ── FFmpeg RTMP ───────────────────────────────────────────────────────────────

function spawnFFmpegRTMP({ backgroundPath, audioPath, audioVolume, rtmpTarget, durationSecs }) {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

  // Si audioPath es un archivo de silencio generado, usar lavfi directo
  const isSilence = !audioPath;

  const args = isSilence ? [
    // ── Video input (loop del fondo) ──────────────────
    '-stream_loop', '-1',
    '-re',
    '-i', backgroundPath,

    // ── Audio generado en tiempo real (sin archivo) ───
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',

    // ── Duración máxima ───────────────────────────────
    '-t', String(durationSecs),

    // ── Mapeo simple ──────────────────────────────────
    '-map', '0:v',
    '-map', '1:a',

    // ── Video encoding ────────────────────────────────
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2500k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-keyint_min', '60',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',

    // ── Audio encoding ────────────────────────────────
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',

    // ── Output RTMP ───────────────────────────────────
    '-f', 'flv',
    rtmpTarget,
  ] : [
    // ── Con archivo de audio real ─────────────────────
    '-stream_loop', '-1',
    '-re',
    '-i', backgroundPath,

    '-stream_loop', '-1',
    '-i', audioPath,

    '-t', String(durationSecs),

    '-filter_complex', `[1:a]volume=${audioVolume}[outa]`,
    '-map', '0:v',
    '-map', '[outa]',

    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2500k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-keyint_min', '60',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',

    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',

    '-f', 'flv',
    rtmpTarget,
  ];

  logger.info(`FFmpeg RTMP → ${rtmpTarget}`);

  const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line.includes('Error') || line.includes('error') || line.includes('failed')) {
      logger.warn(`FFmpeg: ${line.substring(0, 200)}`);
    }
  });

  proc.on('error', (err) => {
    logger.error(`FFmpeg proceso error: ${err.message}`);
  });

  return proc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPinnedComment(category, title) {
  const templates = {
    terror_misterio: `👁 ¡Bienvenidos al directo! Hoy: "${title}"\n¿Ya se suscribieron? 🔔\nComenten qué historia quieren escuchar.`,
    musica_estudiar: `📚 ¡Hola! Ya pueden enfocarse con nosotros.\n"${title}"\n🔔 Suscriban para no perderse ningún directo.`,
    motivacion:      `🔥 ¡Activamos la mente!\n"${title}"\nComenten su meta del día 👇`,
    musica_dormir:   `🌙 Buenas noches. Relájense con nosotros.\n"${title}"\n🔕 Pueden dejar el directo toda la noche.`,
    lofi:            `🎧 Beats para concentrarse.\n"${title}"\n¿Dónde están escuchando desde? 🌎`,
  };
  return templates[category] ?? `¡Bienvenidos al directo! "${title}" 🔔`;
}
