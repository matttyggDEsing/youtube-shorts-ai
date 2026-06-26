// ════════════════════════════════════════
// VIDEO EDITOR — Montaje de video con fluent-ffmpeg + sharp
// ════════════════════════════════════════

import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { parseVtt } from './ttsNarrator.js';
import { logger } from '../utils/logger.js';

// Configuración del video final
const VIDEO_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoBitrate: '4000k',
  audioBitrate: '192k',
  preset: 'fast',
  crf: 23,
};

/**
 * Ejecutar comando ffmpeg y devolver promesa
 */
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
    const inputPath  = imagePaths[i];
    const outputPath = path.join(tempDir, `resized_${String(i + 1).padStart(3, '0')}.jpg`);

    await sharp(inputPath)
      .resize(VIDEO_CONFIG.width, VIDEO_CONFIG.height, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    resizedPaths.push(outputPath);
  }

  logger.ok(`${resizedPaths.length} imágenes redimensionadas`);
  return resizedPaths;
}

/**
 * PASO 2: Convertir cada imagen a clip de video con efecto zoom
 */
async function imagesToClips(resizedPaths, scenes, tempDir) {
  logger.step('Convirtiendo imágenes a clips de video...');
  const clipPaths = [];

  for (let i = 0; i < resizedPaths.length; i++) {
    const imagePath = resizedPaths[i];
    const scene = scenes[i] || { duration: 8 };
    const duration = scene.duration || 8;
    const frames = duration * VIDEO_CONFIG.fps;
    const clipPath = path.join(tempDir, `clip_${String(i + 1).padStart(3, '0')}.mp4`);

    // Filtro zoompan para efecto Ken Burns (zoom suave hacia adentro)
    const zoomFilter = `zoompan=z='min(zoom+0.0015,1.08)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${VIDEO_CONFIG.width}x${VIDEO_CONFIG.height}:fps=${VIDEO_CONFIG.fps}`;

    const command = ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop 1'])
      .videoFilters(zoomFilter)
      .outputOptions([
        `-t ${duration}`,
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-crf ${VIDEO_CONFIG.crf}`,
        `-pix_fmt yuv420p`,
        `-r ${VIDEO_CONFIG.fps}`,
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

  // Crear archivo de lista para ffmpeg concat
  const concatFile = path.join(tempDir, 'concat.txt');
  const concatContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatFile, concatContent, 'utf8');

  const joinedPath = path.join(tempDir, 'joined.mp4');

  const command = ffmpeg()
    .input(concatFile)
    .inputOptions(['-f concat', '-safe 0'])
    .outputOptions(['-c copy'])
    .output(joinedPath);

  await runFfmpeg(command);
  logger.ok('Clips concatenados exitosamente');
  return joinedPath;
}

/**
 * PASO 4: Combinar video con narración de audio
 */
async function addAudio(videoPath, audioPath, tempDir) {
  logger.step('Agregando narración de audio...');
  const withAudioPath = path.join(tempDir, 'with_audio.mp4');

  const command = ffmpeg()
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
    .output(withAudioPath);

  await runFfmpeg(command);
  logger.ok('Audio agregado exitosamente');
  return withAudioPath;
}

/**
 * PASO 5: Generar filtro de subtítulos drawtext para ffmpeg
 * Escapa caracteres especiales del texto para el filtro drawtext
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
 * Construir filtro complejo de subtítulos desde cues VTT
 */
function buildSubtitleFilter(vttCues) {
  if (!vttCues || vttCues.length === 0) return null;

  // Construir filtro drawtext para cada cue
  const filters = vttCues.map((cue) => {
    const text = escapeDrawtext(cue.text);
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

  return filters.join(',');
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
  const subtitleFilter = buildSubtitleFilter(vttCues);

  try {
    const command = ffmpeg()
      .input(videoPath)
      .videoFilters(subtitleFilter)
      .outputOptions([
        `-c:v libx264`,
        `-preset ${VIDEO_CONFIG.preset}`,
        `-crf ${VIDEO_CONFIG.crf}`,
        `-c:a copy`,
      ])
      .output(withSubsPath);

    await runFfmpeg(command);
    logger.ok(`Subtítulos agregados: ${vttCues.length} cues`);
    return withSubsPath;
  } catch (error) {
    logger.warn(`No se pudieron agregar subtítulos: ${error.message}. Continuando sin ellos.`);
    return videoPath;
  }
}

/**
 * PASO 6: Crear clip de intro (fondo negro + título)
 */
async function createIntro(title, tempDir) {
  logger.step('Creando intro...');
  const introPath = path.join(tempDir, 'intro.mp4');
  const duration = 1.5;
  const escapedTitle = escapeDrawtext(title.substring(0, 50));

  const command = ffmpeg()
    .input(`color=c=black:s=${VIDEO_CONFIG.width}x${VIDEO_CONFIG.height}:r=${VIDEO_CONFIG.fps}`)
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
    .output(introPath);

  await runFfmpeg(command);
  logger.ok('Intro creada');
  return introPath;
}

/**
 * PASO 6: Crear clip de outro (fondo negro + CTA de suscripción)
 */
async function createOutro(channelName, tempDir) {
  logger.step('Creando outro...');
  const outroPath = path.join(tempDir, 'outro.mp4');
  const duration = 2;
  const channelText = escapeDrawtext(channelName || 'Mi Canal');

  const command = ffmpeg()
    .input(`color=c=black:s=${VIDEO_CONFIG.width}x${VIDEO_CONFIG.height}:r=${VIDEO_CONFIG.fps}`)
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
    .output(outroPath);

  await runFfmpeg(command);
  logger.ok('Outro creada');
  return outroPath;
}

/**
 * PASO 6: Concatenar intro + video + outro (sin audio en intro/outro)
 */
async function addIntroOutro(mainVideoPath, introPath, outroPath, tempDir) {
  logger.step('Ensamblando intro + video + outro...');

  // Agregar audio silencioso a intro y outro para compatibilidad
  const introWithAudio = path.join(tempDir, 'intro_audio.mp4');
  const outroWithAudio = path.join(tempDir, 'outro_audio.mp4');

  // Agregar silencio a intro
  await runFfmpeg(
    ffmpeg()
      .input(introPath)
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f lavfi'])
      .outputOptions(['-c:v copy', '-c:a aac', '-shortest', '-map 0:v', '-map 1:a'])
      .output(introWithAudio)
  );

  // Agregar silencio a outro
  await runFfmpeg(
    ffmpeg()
      .input(outroPath)
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f lavfi'])
      .outputOptions(['-c:v copy', '-c:a aac', '-shortest', '-map 0:v', '-map 1:a'])
      .output(outroWithAudio)
  );

  // Concatenar todo
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
 * PASO 7: Exportar video final con configuración óptima
 */
async function exportFinal(inputPath, outputPath) {
  logger.step('Exportando video final...');

  const command = ffmpeg()
    .input(inputPath)
    .outputOptions([
      `-c:v libx264`,
      `-preset ${VIDEO_CONFIG.preset}`,
      `-crf ${VIDEO_CONFIG.crf}`,
      `-c:a aac`,
      `-b:a ${VIDEO_CONFIG.audioBitrate}`,
      `-movflags +faststart`,   // Optimizar para streaming
      `-pix_fmt yuv420p`,
    ])
    .output(outputPath);

  await runFfmpeg(command);
  logger.ok(`Video final exportado: ${path.basename(outputPath)}`);
}

/**
 * Función principal: crear el Short completo
 * @param {Array} scenes - Array de escenas con duración
 * @param {Array} imagePaths - Rutas de imágenes generadas
 * @param {string} audioPath - Ruta del audio MP3
 * @param {string} vttPath - Ruta del archivo VTT de subtítulos
 * @param {string} outputPath - Ruta final del video MP4
 * @param {string} title - Título del video (para intro)
 * @returns {Promise<string>} Ruta del video final
 */
export async function createShort(scenes, imagePaths, audioPath, vttPath, outputPath, title) {
  const tempDir = path.dirname(outputPath);

  try {
    // PASO 1: Redimensionar imágenes
    const resizedPaths = await resizeImages(imagePaths, tempDir);

    // PASO 2: Convertir imágenes a clips con zoom
    const clipPaths = await imagesToClips(resizedPaths, scenes, tempDir);

    // PASO 3: Concatenar clips
    const joinedPath = await concatenateClips(clipPaths, tempDir);

    // PASO 4: Agregar audio
    const withAudioPath = await addAudio(joinedPath, audioPath, tempDir);

    // PASO 5: Agregar subtítulos
    const withSubsPath = await addSubtitles(withAudioPath, vttPath, tempDir);

    // PASO 6: Crear intro y outro
    const channelName = process.env.CHANNEL_NAME || 'Mi Canal de Historias';
    const introPath = await createIntro(title, tempDir);
    const outroPath = await createOutro(channelName, tempDir);

    // PASO 6b: Ensamblar todo
    const assembledPath = await addIntroOutro(withSubsPath, introPath, outroPath, tempDir);

    // PASO 7: Export final
    await exportFinal(assembledPath, outputPath);

    return outputPath;

  } catch (error) {
    throw new Error(`Error en montaje de video: ${error.message}`);
  }
}
