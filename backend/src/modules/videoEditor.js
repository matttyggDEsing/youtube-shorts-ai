// ════════════════════════════════════════
// VIDEO EDITOR v2 — Montaje cinematográfico con clips reales de Pexels
// Fix audio: normalizar a 44100Hz estéreo antes de mezclar
// ════════════════════════════════════════

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseVtt } from './ttsNarrator.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const VIDEO_CONFIG = {
  width:        1080,
  height:       1920,
  fps:          30,
  videoBitrate: '4000k',
  audioBitrate: '192k',
  preset:       'fast',
  crf:          23,
  // Audio normalizado — SIEMPRE 44100Hz estéreo para evitar distorsión al concatenar
  audioSampleRate: 44100,
  audioChannels:   2,
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

/**
 * Normalizar audio MP3 del TTS a 44100Hz estéreo AAC
 * El TTS genera 24kHz mono — al mezclarlo con anullsrc de 44100Hz
 * sin recodificar produce audio distorsionado ("pip").
 * Este paso lo convierte antes de cualquier mezcla.
 */
async function normalizeAudio(inputAudioPath, tempDir) {
  logger.step('Normalizando audio TTS a 44100Hz estéreo...');
  const normalizedPath = path.join(tempDir, 'narration_normalized.aac');

  await runFfmpegDirect([
    '-y',
    '-i', inputAudioPath,
    '-c:a', 'aac',
    '-b:a', VIDEO_CONFIG.audioBitrate,
    '-ar', String(VIDEO_CONFIG.audioSampleRate),
    '-ac', String(VIDEO_CONFIG.audioChannels),
    normalizedPath,
  ]);

  logger.ok('Audio normalizado');
  return normalizedPath;
}

/**
 * PASO 1 — Procesar cada clip raw de Pexels:
 * - Recortar a 1-2s desde offset aleatorio
 * - Convertir a 1080x1920 (9:16)
 * - Color grading cálido cinematográfico
 * - Cámara lenta sutil
 */
async function processClip(rawClipPath, clipDuration, outputPath, index) {
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;

  let sourceDuration = 5;
  try {
    sourceDuration = await getVideoDuration(rawClipPath);
  } catch {
    sourceDuration = 5;
  }

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
    '-y',
    '-ss', String(offset),
    '-i', rawClipPath,
    '-t', dur,
    '-vf', filters,
    '-c:v', 'libx264',
    '-preset', VIDEO_CONFIG.preset,
    '-crf', String(VIDEO_CONFIG.crf),
    '-pix_fmt', 'yuv420p',
    '-an',
    '-r', String(VIDEO_CONFIG.fps),
    outputPath,
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
      if (!clip) {
        logger.warn(`Clip ${globalIndex + 1} ausente, saltando`);
        return null;
      }
      const outPath = path.join(tempDir, `clip_proc_${String(globalIndex + 1).padStart(3, '0')}.mp4`);
      try {
        await processClip(clip.path, clip.duration, outPath, globalIndex);
        return outPath;
      } catch (err) {
        logger.warn(`Error procesando clip ${globalIndex + 1}: ${err.message}`);
        return null;
      }
    });
    const results = await Promise.all(promises);
    processedPaths.push(...results);
  }

  const validos = processedPaths.filter(Boolean);
  logger.ok(`${validos.length}/${rawClips.length} clips procesados`);
  return processedPaths;
}

/**
 * PASO 3 — Concatenar clips procesados (solo video, sin audio)
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
 * PASO 4 — Mezclar video mudo con narración normalizada
 * El audio ya viene en 44100Hz estéreo AAC desde normalizeAudio()
 */
async function addAudio(videoPath, normalizedAudioPath, tempDir) {
  logger.step('Mezclando video con narración...');
  const withAudioPath = path.join(tempDir, 'with_audio.mp4');

  let videoDur = 0;
  let audioDur = 0;
  try {
    videoDur = await getVideoDuration(videoPath);
    audioDur = await getVideoDuration(normalizedAudioPath);
  } catch { /* continuar */ }

  logger.info(`Duración video: ${videoDur.toFixed(1)}s | audio: ${audioDur.toFixed(1)}s`);

  if (videoDur > 0 && audioDur > 0 && videoDur < audioDur) {
    logger.warn('Video más corto que audio — loopeando video');
    await runFfmpegDirect([
      '-y',
      '-stream_loop', '-1', '-i', videoPath,
      '-i', normalizedAudioPath,
      '-c:v', 'copy',
      '-c:a', 'copy', // ya está normalizado, solo copiar
      '-shortest',
      '-map', '0:v:0',
      '-map', '1:a:0',
      withAudioPath,
    ]);
  } else {
    await runFfmpegDirect([
      '-y',
      '-i', videoPath,
      '-i', normalizedAudioPath,
      '-c:v', 'copy',
      '-c:a', 'copy', // ya está normalizado, solo copiar
      '-shortest',
      '-map', '0:v:0',
      '-map', '1:a:0',
      withAudioPath,
    ]);
  }

  logger.ok('Audio mezclado');
  return withAudioPath;
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

/**
 * PASO 5 — Subtítulos grandes estilo Short viral
 */
async function addSubtitles(videoPath, vttPath, tempDir) {
  logger.step('Agregando subtítulos cinematográficos...');

  const vttCues = parseVtt(vttPath);
  if (!vttCues.length) {
    logger.warn('Sin cues VTT, omitiendo subtítulos');
    return videoPath;
  }

  const withSubsPath = path.join(tempDir, 'with_subs.mp4');

  const vfFilter = vttCues.map((cue) => {
    const text   = escapeDrawtext(cue.text);
    const enable = `between(t\\,${cue.start.toFixed(3)}\\,${cue.end.toFixed(3)})`;
    return `drawtext=text='${text}':enable='${enable}':fontsize=64:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.55:boxborderw=18`;
  }).join(',');

  try {
    await runFfmpegDirect([
      '-y', '-i', videoPath,
      '-vf', vfFilter,
      '-c:v', 'libx264',
      '-preset', VIDEO_CONFIG.preset,
      '-crf', String(VIDEO_CONFIG.crf),
      '-c:a', 'copy', // audio ya normalizado, no tocar
      withSubsPath,
    ], 300000);
    logger.ok(`Subtítulos agregados: ${vttCues.length} cues`);
    return withSubsPath;
  } catch (error) {
    logger.warn(`No se pudieron agregar subtítulos: ${error.message}`);
    return videoPath;
  }
}

/**
 * PASO 6a — Intro con título
 * Genera video mudo — el audio silencioso se agrega en addIntroOutro
 */
async function createIntro(title, tempDir) {
  logger.step('Creando intro...');
  const introPath    = path.join(tempDir, 'intro.mp4');
  const duration     = 1.2;
  const W            = VIDEO_CONFIG.width;
  const H            = VIDEO_CONFIG.height;
  const escapedTitle = escapeDrawtext(title.substring(0, 50));

  const vfFilter = `drawtext=text='${escapedTitle}':fontsize=68:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t\\,0.25)\\,t/0.25\\,if(lt(t\\,0.95)\\,1\\,(${duration}-t)/0.25))'`;

  await runFfmpegDirect([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x0a0a0a:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', vfFilter,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', VIDEO_CONFIG.preset,
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_CONFIG.fps),
    introPath,
  ]);

  logger.ok('Intro creada');
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
    `drawtext=text='¿Querés saber qué pasó?':fontsize=58:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h/2)-120:alpha='if(lt(t\\,0.4)\\,t/0.4\\,1)'`,
    `drawtext=text='${channel}':fontsize=50:fontcolor=#FFD700:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h/2)-20:alpha='if(lt(t\\,0.5)\\,0\\,if(lt(t\\,0.9)\\,(t-0.5)/0.4\\,1))'`,
    `drawtext=text='Seguí para la Parte 2 👇':fontsize=46:fontcolor=#FF4444:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h/2)+80:alpha='if(lt(t\\,0.8)\\,0\\,if(lt(t\\,1.2)\\,(t-0.8)/0.4\\,1))'`,
  ].join(',');

  await runFfmpegDirect([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x0a0a0a:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', vfFilter,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', VIDEO_CONFIG.preset,
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_CONFIG.fps),
    outroPath,
  ]);

  logger.ok('Outro creada');
  return outroPath;
}

/**
 * PASO 6c — Ensamblar intro + video + outro
 * El audio silencioso de intro/outro DEBE tener el mismo formato
 * que el audio de la narración (44100Hz estéreo AAC) para poder concatenar
 */
async function addIntroOutro(mainVideoPath, introPath, outroPath, tempDir) {
  logger.step('Ensamblando intro + video + outro...');

  const introWithAudio = path.join(tempDir, 'intro_audio.mp4');
  const outroWithAudio = path.join(tempDir, 'outro_audio.mp4');

  // anullsrc con la MISMA frecuencia y canales que el audio normalizado
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

/**
 * Función principal
 */
export async function createShort(scenes, rawClips, audioPath, vttPath, outputPath, title) {
  const tempDir = path.resolve(path.dirname(audioPath));

  try {
    // Normalizar audio PRIMERO — convierte 24kHz mono → 44100Hz estéreo AAC
    const normalizedAudio = await normalizeAudio(audioPath, tempDir);

    const processedPaths = await processAllClips(rawClips, scenes, tempDir);
    const joinedPath     = await concatenateClips(processedPaths, tempDir);
    const withAudioPath  = await addAudio(joinedPath, normalizedAudio, tempDir);
    const withSubsPath   = await addSubtitles(withAudioPath, vttPath, tempDir);

    const channelName    = process.env.CHANNEL_NAME || 'Mi Canal de Historias';
    const introPath      = await createIntro(title, tempDir);
    const outroPath      = await createOutro(channelName, tempDir);
    const assembledPath  = await addIntroOutro(withSubsPath, introPath, outroPath, tempDir);

    await exportFinal(assembledPath, outputPath);
    return outputPath;

  } catch (error) {
    throw new Error(`Error en montaje de video: ${error.message}`);
  }
}
