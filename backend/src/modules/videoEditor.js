// ════════════════════════════════════════
// VIDEO EDITOR — Montaje de video con fluent-ffmpeg + sharp
// ════════════════════════════════════════

import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseVtt } from './ttsNarrator.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const VIDEO_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 24,
  videoBitrate: '3000k',
  audioBitrate: '192k',
  preset: 'veryfast',
  crf: 26,
};

/**
 * Obtener la ruta del binario ffmpeg
 */
function getFfmpegPath() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

// Mantenido por compatibilidad — solo usado en addSubtitles (fallback tolerante a errores)
function runFfmpeg(command) {
  return new Promise((resolve, reject) => {
    command
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
  });
}

/**
 * Ejecutar ffmpeg directamente con execFile
 * Evita el bug de fluent-ffmpeg en Windows donde el evento 'end'
 * nunca dispara con -loop 1, -f concat, inputs lavfi, o mux de audio/video.
 */
async function runFfmpegDirect(args) {
  const bin = getFfmpegPath();
  try {
    await execFileAsync(bin, args, { timeout: 120000 });
  } catch (err) {
    throw new Error(`FFmpeg error: ${err.stderr || err.message}`);
  }
}

/**
 * PASO 1: Redimensionar imágenes a 1080x1920 con sharp
 */
async function resizeImages(imagePaths, tempDir) {
  logger.step('Redimensionando imágenes a 1080x1920...');
  const resizedPaths = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const outputPath = path.join(tempDir, `resized_${String(i + 1).padStart(3, '0')}.jpg`);
    await sharp(imagePaths[i])
      .resize(VIDEO_CONFIG.width, VIDEO_CONFIG.height, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 85 })
      .toFile(outputPath);
    resizedPaths.push(outputPath);
  }

  logger.ok(`${resizedPaths.length} imágenes redimensionadas`);
  return resizedPaths;
}

/**
 * PASO 2: Imagen → clip de video
 * Usa execFile directamente para evitar el bug de fluent-ffmpeg en Windows
 * con -loop 1 donde el evento 'end' nunca dispara.
 */
async function imagesToClips(resizedPaths, scenes, tempDir) {
  logger.step('Convirtiendo imágenes a clips de video...');
  const clipPaths = [];

  const W = String(VIDEO_CONFIG.width);
  const H = String(VIDEO_CONFIG.height);

  for (let i = 0; i < resizedPaths.length; i++) {
    const scene    = scenes[i] || { duration: 8 };
    const duration = String(scene.duration || 8);
    const clipPath = path.join(tempDir, `clip_${String(i + 1).padStart(3, '0')}.mp4`);
    const imgPath  = resizedPaths[i];

    const args = [
      '-y',
      '-loop', '1',
      '-i', imgPath,
      '-t', duration,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
      '-r', String(VIDEO_CONFIG.fps),
      '-c:v', 'libx264',
      '-preset', VIDEO_CONFIG.preset,
      '-crf', String(VIDEO_CONFIG.crf),
      '-pix_fmt', 'yuv420p',
      '-tune', 'stillimage',
      clipPath,
    ];

    await runFfmpegDirect(args);
    clipPaths.push(clipPath);
    logger.info(`Clip ${i + 1}/${resizedPaths.length} listo (${duration}s)`);
  }

  logger.ok('Todos los clips generados');
  return clipPaths;
}

/**
 * PASO 3: Concatenar clips en un solo video
 * FIX: migrado a runFfmpegDirect — fluent-ffmpeg no dispara 'end' en Windows con -f concat
 */
async function concatenateClips(clipPaths, tempDir) {
  logger.step('Concatenando clips...');

  const concatFile = path.resolve(tempDir, 'concat.txt');
  fs.writeFileSync(
    concatFile,
    clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );

  const joinedPath = path.resolve(tempDir, 'joined.mp4');

  await runFfmpegDirect([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-c', 'copy',
    joinedPath,
  ]);

  logger.ok('Clips concatenados exitosamente');
  return joinedPath;
}

/**
 * PASO 4: Combinar video con narración de audio
 * FIX: migrado a runFfmpegDirect — fluent-ffmpeg no dispara 'end' en Windows
 * al muxear video + audio, dejando el proceso tildado indefinidamente.
 */
async function addAudio(videoPath, audioPath, tempDir) {
  logger.step('Agregando narración de audio...');
  const withAudioPath = path.join(tempDir, 'with_audio.mp4');

  await runFfmpegDirect([
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', VIDEO_CONFIG.audioBitrate,
    '-shortest',
    '-map', '0:v:0',
    '-map', '1:a:0',
    withAudioPath,
  ]);

  logger.ok('Audio agregado exitosamente');
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
 * PASO 5: Agregar subtítulos al video
 * Nota: sigue usando runFfmpeg (fluent-ffmpeg) porque el filtro drawtext complejo
 * es difícil de pasar sin escapado adicional via execFile. Si también se tilda,
 * migrarlo a runFfmpegDirect igual que los otros pasos.
 */
async function addSubtitles(videoPath, vttPath, tempDir) {
  logger.step('Agregando subtítulos...');

  const vttCues = parseVtt(vttPath);
  if (vttCues.length === 0) {
    logger.warn('Sin cues VTT, omitiendo subtítulos');
    return videoPath;
  }

  const withSubsPath = path.join(tempDir, 'with_subs.mp4');

  const filters = vttCues.map((cue) => {
    const text   = escapeDrawtext(cue.text);
    const enable = `between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})`;
    return [
      `drawtext=text='${text}'`,
      `enable='${enable}'`,
      `fontsize=52`,
      `fontcolor=white`,
      `x=(w-text_w)/2`,
      `y=h-220`,
      `box=1`,
      `boxcolor=black@0.65`,
      `boxborderw=12`,
      `line_spacing=8`,
    ].join(':');
  });

  try {
    await runFfmpeg(
      ffmpeg()
        .input(videoPath)
        .outputOptions([
          `-vf ${filters.join(',')}`,
          `-c:v libx264`,
          `-preset ${VIDEO_CONFIG.preset}`,
          `-crf ${VIDEO_CONFIG.crf}`,
          `-c:a copy`,
        ])
        .output(withSubsPath)
    );
    logger.ok(`Subtítulos agregados: ${vttCues.length} cues`);
    return withSubsPath;
  } catch (error) {
    logger.warn(`No se pudieron agregar subtítulos: ${error.message}. Continuando sin ellos.`);
    return videoPath;
  }
}

/**
 * PASO 6: Crear intro
 */
async function createIntro(title, tempDir) {
  logger.step('Creando intro...');
  const introPath    = path.join(tempDir, 'intro.mp4');
  const duration     = 1.5;
  const escapedTitle = escapeDrawtext(title.substring(0, 50));
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;

  await runFfmpegDirect([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', `drawtext=text='${escapedTitle}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,0.3),t/0.3,if(lt(t,1.2),1,(${duration}-t)/0.3))'`,
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
 * PASO 6b: Crear outro
 */
async function createOutro(channelName, tempDir) {
  logger.step('Creando outro...');
  const outroPath   = path.join(tempDir, 'outro.mp4');
  const duration    = 2;
  const channelText = escapeDrawtext(channelName || 'Mi Canal');
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;

  await runFfmpegDirect([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`,
    '-vf', `drawtext=text='${channelText}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h/2)-80:alpha='if(lt(t,0.4),t/0.4,1)',drawtext=text='Suscribite para mas historias':fontsize=40:fontcolor=#FF0000:x=(w-text_w)/2:y=(h/2)+20:alpha='if(lt(t,0.6),0,if(lt(t,1),(t-0.6)/0.4,1))'`,
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
 * PASO 6c: Ensamblar intro + video + outro
 * FIX: migrado a runFfmpegDirect — fluent-ffmpeg no dispara 'end' en Windows
 * con inputs lavfi ni con -f concat
 */
async function addIntroOutro(mainVideoPath, introPath, outroPath, tempDir) {
  logger.step('Ensamblando intro + video + outro...');

  const introWithAudio = path.join(tempDir, 'intro_audio.mp4');
  const outroWithAudio = path.join(tempDir, 'outro_audio.mp4');

  await runFfmpegDirect([
    '-y',
    '-i', introPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'copy', '-c:a', 'aac', '-shortest',
    '-map', '0:v', '-map', '1:a',
    introWithAudio,
  ]);

  await runFfmpegDirect([
    '-y',
    '-i', outroPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'copy', '-c:a', 'aac', '-shortest',
    '-map', '0:v', '-map', '1:a',
    outroWithAudio,
  ]);

  const finalConcatFile = path.resolve(tempDir, 'final_concat.txt');
  fs.writeFileSync(finalConcatFile, [
    `file '${path.resolve(introWithAudio).replace(/\\/g, '/')}'`,
    `file '${path.resolve(mainVideoPath).replace(/\\/g, '/')}'`,
    `file '${path.resolve(outroWithAudio).replace(/\\/g, '/')}'`,
  ].join('\n'), 'utf8');

  const assembledPath = path.join(tempDir, 'assembled.mp4');

  await runFfmpegDirect([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', finalConcatFile,
    '-c', 'copy',
    assembledPath,
  ]);

  logger.ok('Intro y outro ensamblados');
  return assembledPath;
}

/**
 * PASO 7: Exportar video final
 * FIX: migrado a runFfmpegDirect — fluent-ffmpeg no dispara 'end' en Windows
 * al recodificar el video final, dejando el proceso tildado indefinidamente.
 */
async function exportFinal(inputPath, outputPath) {
  logger.step('Exportando video final...');

  await runFfmpegDirect([
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', VIDEO_CONFIG.preset,
    '-crf', String(VIDEO_CONFIG.crf),
    '-c:a', 'aac',
    '-b:a', VIDEO_CONFIG.audioBitrate,
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ]);

  logger.ok(`Video final exportado: ${path.basename(outputPath)}`);
}

/**
 * Función principal
 */
export async function createShort(scenes, imagePaths, audioPath, vttPath, outputPath, title) {
  // FIX: usar el directorio del audio (temp/<id>/) como tempDir,
  // no el directorio del output — en Windows path.dirname(outputPath)
  // mezcla rutas y genera "output\output/clip_001.mp4"
  const tempDir = path.resolve(path.dirname(audioPath));

  try {
    const resizedPaths  = await resizeImages(imagePaths, tempDir);
    const clipPaths     = await imagesToClips(resizedPaths, scenes, tempDir);
    const joinedPath    = await concatenateClips(clipPaths, tempDir);
    const withAudioPath = await addAudio(joinedPath, audioPath, tempDir);
    const withSubsPath  = await addSubtitles(withAudioPath, vttPath, tempDir);

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
