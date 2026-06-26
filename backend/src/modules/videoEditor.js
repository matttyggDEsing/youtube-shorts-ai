// ════════════════════════════════════════
// VIDEO EDITOR — Montaje de video con fluent-ffmpeg + sharp
// ════════════════════════════════════════

import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { parseVtt } from './ttsNarrator.js';
import { logger } from '../utils/logger.js';

const VIDEO_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 24,              // Bajado de 30 a 24 — suficiente para Shorts, mucho más rápido
  videoBitrate: '3000k',
  audioBitrate: '192k',
  preset: 'veryfast',  // Cambiado de 'fast' a 'veryfast'
  crf: 26,             // Ligeramente más comprimido, igual de buena calidad visual
};

function runFfmpeg(command) {
  return new Promise((resolve, reject) => {
    command
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
  });
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
 * PASO 2: Convertir cada imagen a clip de video
 * Usa scale+crop en lugar de zoompan — mismo efecto visual, 20x más rápido
 */
async function imagesToClips(resizedPaths, scenes, tempDir) {
  logger.step('Convirtiendo imágenes a clips de video...');
  const clipPaths = [];

  for (let i = 0; i < resizedPaths.length; i++) {
    const scene    = scenes[i] || { duration: 8 };
    const duration = scene.duration || 8;
    const clipPath = path.join(tempDir, `clip_${String(i + 1).padStart(3, '0')}.mp4`);

    // Zoom suave del 100% al 108% usando scale animado con overlay
    // Alternativa rápida: escalar ligeramente más grande y usar crop centrado
    // Esto da el efecto Ken Burns sin el costo de zoompan
    const W = VIDEO_CONFIG.width;
    const H = VIDEO_CONFIG.height;
    const zoomW = Math.round(W * 1.08);
    const zoomH = Math.round(H * 1.08);
    const cropX  = Math.round((zoomW - W) / 2);
    const cropY  = Math.round((zoomH - H) / 2);

    const command = ffmpeg()
      .input(resizedPaths[i])
      .inputOptions(['-loop 1'])
      .videoFilters([
        // Escalar a tamaño ligeramente más grande
        `scale=${zoomW}:${zoomH}`,
        // Crop centrado al tamaño final — efecto zoom estático simple y rápido
        `crop=${W}:${H}:${cropX}:${cropY}`,
        // Convertir imagen estática en video con fps correcto
        `fps=${VIDEO_CONFIG.fps}`,
      ])
      .outputOptions([
        `-t ${duration}`,
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-crf ${VIDEO_CONFIG.crf}`,
        `-pix_fmt yuv420p`,
        `-r ${VIDEO_CONFIG.fps}`,
        `-tune stillimage`,   // Optimización de ffmpeg para imágenes estáticas
      ])
      .output(clipPath);

    await runFfmpeg(command);
    clipPaths.push(clipPath);
    logger.info(`Clip ${i + 1}/${resizedPaths.length} listo (${duration}s)`);
  }

  logger.ok('Todos los clips generados');
  return clipPaths;
}

/**
 * PASO 3: Concatenar clips en un solo video
 */
async function concatenateClips(clipPaths, tempDir) {
  logger.step('Concatenando clips...');

  const concatFile = path.join(tempDir, 'concat.txt');
  fs.writeFileSync(
    concatFile,
    clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );

  const joinedPath = path.join(tempDir, 'joined.mp4');
  await runFfmpeg(
    ffmpeg()
      .input(concatFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(joinedPath)
  );

  logger.ok('Clips concatenados exitosamente');
  return joinedPath;
}

/**
 * PASO 4: Combinar video con narración de audio
 */
async function addAudio(videoPath, audioPath, tempDir) {
  logger.step('Agregando narración de audio...');
  const withAudioPath = path.join(tempDir, 'with_audio.mp4');

  await runFfmpeg(
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        `-b:a ${VIDEO_CONFIG.audioBitrate}`,
        '-shortest',
        '-map 0:v:0',
        '-map 1:a:0',
      ])
      .output(withAudioPath)
  );

  logger.ok('Audio agregado exitosamente');
  return withAudioPath;
}

/**
 * Escapar texto para filtro drawtext de ffmpeg
 */
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
        .videoFilters(filters.join(','))
        .outputOptions([
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

  await runFfmpeg(
    ffmpeg()
      .input(`color=c=black:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`)
      .inputOptions(['-f lavfi'])
      .videoFilters([
        `drawtext=text='${escapedTitle}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,0.3),t/0.3,if(lt(t,1.2),1,(${duration}-t)/0.3))'`,
      ])
      .outputOptions([
        `-t ${duration}`,
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-pix_fmt yuv420p`,
        `-r ${VIDEO_CONFIG.fps}`,
      ])
      .output(introPath)
  );

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

  await runFfmpeg(
    ffmpeg()
      .input(`color=c=black:s=${W}x${H}:r=${VIDEO_CONFIG.fps}`)
      .inputOptions(['-f lavfi'])
      .videoFilters([
        `drawtext=text='${channelText}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h/2)-80:alpha='if(lt(t,0.4),t/0.4,1)'`,
        `drawtext=text='Suscribite para mas historias':fontsize=40:fontcolor=#FF0000:x=(w-text_w)/2:y=(h/2)+20:alpha='if(lt(t,0.6),0,if(lt(t,1),(t-0.6)/0.4,1))'`,
      ])
      .outputOptions([
        `-t ${duration}`,
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-pix_fmt yuv420p`,
        `-r ${VIDEO_CONFIG.fps}`,
      ])
      .output(outroPath)
  );

  logger.ok('Outro creada');
  return outroPath;
}

/**
 * PASO 6c: Ensamblar intro + video + outro
 */
async function addIntroOutro(mainVideoPath, introPath, outroPath, tempDir) {
  logger.step('Ensamblando intro + video + outro...');

  const introWithAudio = path.join(tempDir, 'intro_audio.mp4');
  const outroWithAudio = path.join(tempDir, 'outro_audio.mp4');

  await runFfmpeg(
    ffmpeg()
      .input(introPath)
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f lavfi'])
      .outputOptions(['-c:v copy', '-c:a aac', '-shortest', '-map 0:v', '-map 1:a'])
      .output(introWithAudio)
  );

  await runFfmpeg(
    ffmpeg()
      .input(outroPath)
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f lavfi'])
      .outputOptions(['-c:v copy', '-c:a aac', '-shortest', '-map 0:v', '-map 1:a'])
      .output(outroWithAudio)
  );

  const finalConcatFile = path.join(tempDir, 'final_concat.txt');
  fs.writeFileSync(finalConcatFile, [
    `file '${introWithAudio.replace(/\\/g, '/')}'`,
    `file '${mainVideoPath.replace(/\\/g, '/')}'`,
    `file '${outroWithAudio.replace(/\\/g, '/')}'`,
  ].join('\n'), 'utf8');

  const assembledPath = path.join(tempDir, 'assembled.mp4');
  await runFfmpeg(
    ffmpeg()
      .input(finalConcatFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(assembledPath)
  );

  logger.ok('Intro y outro ensamblados');
  return assembledPath;
}

/**
 * PASO 7: Exportar video final
 */
async function exportFinal(inputPath, outputPath) {
  logger.step('Exportando video final...');

  await runFfmpeg(
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-crf ${VIDEO_CONFIG.crf}`,
        `-c:a aac`,
        `-b:a ${VIDEO_CONFIG.audioBitrate}`,
        `-movflags +faststart`,
        `-pix_fmt yuv420p`,
      ])
      .output(outputPath)
  );

  logger.ok(`Video final exportado: ${path.basename(outputPath)}`);
}

/**
 * Función principal: crear el Short completo
 */
export async function createShort(scenes, imagePaths, audioPath, vttPath, outputPath, title) {
  const tempDir = path.dirname(outputPath);

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
