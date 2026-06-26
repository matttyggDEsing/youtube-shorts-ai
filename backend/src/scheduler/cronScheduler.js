// ════════════════════════════════════════
// CRON SCHEDULER — Publicación automática con node-cron
// ════════════════════════════════════════

import cron from 'node-cron';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { generateStory } from '../modules/storyGenerator.js';
import { generateNarration } from '../modules/ttsNarrator.js';
import { generateSceneImages } from '../modules/imageGenerator.js';
import { createShort } from '../modules/videoEditor.js';
import { uploadToYoutube, hasValidToken } from '../modules/youtubeUploader.js';
import { generateOutputFilename, saveToHistory, cleanTempDir } from '../utils/fileManager.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const CONFIG_PATH = './config.json';

// Instancia activa del cron task
let activeTask = null;

/**
 * Leer configuración del scheduler
 */
function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaultConfig = {
        enabled: false,
        cronExpression: '0 18 * * *',
        categoryRotation: ['terror', 'misterio', 'motivacion'],
        currentIndex: 0,
        autoUpload: true,
        voice: 'es-AR-ElenaNeural',
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { enabled: false };
  }
}

/**
 * Guardar configuración actualizada
 */
function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Pipeline completo de generación (usado por cron y por la ruta manual)
 * @param {Object} options - { category, voice, autoUpload, onProgress }
 * @returns {Promise<Object>} Resultado del pipeline
 */
export async function runPipeline({ category, voice, autoUpload = false, onProgress = null }) {
  const id = uuidv4();
  const tempDir = `./temp/${id}`;
  fs.mkdirSync(tempDir, { recursive: true });

  const emit = (step, progress, message, extra = {}) => {
    logger.step(`[${step}] ${message}`);
    if (onProgress) onProgress({ step, progress, message, ...extra });
  };

  let historyEntry = {
    id,
    title: '',
    category,
    filePath: '',
    youtubeUrl: null,
    status: 'processing',
    createdAt: new Date().toISOString(),
    duration: 0,
  };

  try {
    // ── PASO 1: Generar historia ──────────────────────────────
    emit('story', 10, 'Generando historia con IA...');
    const story = await generateStory(category, 60);

    historyEntry.title = story.title;
    saveToHistory(historyEntry);

    // ── PASO 2: Narración TTS ─────────────────────────────────
    emit('tts', 25, 'Creando narración de voz...');
    const audioBase = path.join(tempDir, 'narration');
    const { audioPath, vttPath, durationSeconds } = await generateNarration(
      story.fullNarration,
      audioBase,
      voice || process.env.DEFAULT_VOICE || 'es-AR-ElenaNeural'
    );
    historyEntry.duration = Math.round(durationSeconds);

    // ── PASO 3: Generar imágenes ──────────────────────────────
    emit('images', 45, 'Generando imágenes para cada escena...');
    const imagesDir = path.join(tempDir, 'images');
    const imagePaths = await generateSceneImages(story.scenes, imagesDir);

    // ── PASO 4: Montar video ──────────────────────────────────
    emit('video', 70, 'Montando video con efectos y subtítulos...');
    const outputFilename = generateOutputFilename(category, story.title);
    const outputPath = path.join(process.env.OUTPUT_DIR || './output', outputFilename);

    await createShort(
      story.scenes,
      imagePaths,
      audioPath,
      vttPath,
      outputPath,
      story.title
    );

    historyEntry.filePath = outputPath;
    historyEntry.status = 'local';
    saveToHistory(historyEntry);

    // ── PASO 5: Subir a YouTube (opcional) ───────────────────
    if (autoUpload && hasValidToken()) {
      emit('upload', 88, 'Subiendo a YouTube...');
      const { videoId, url } = await uploadToYoutube(outputPath, {
        title: story.title,
        description: story.description,
        tags: story.tags,
        categoryId: '24',
      });

      historyEntry.youtubeUrl = url;
      historyEntry.youtubeId = videoId;
      historyEntry.status = 'uploaded';
      saveToHistory(historyEntry);

      emit('done', 100, '¡Video subido a YouTube!', { url, id });
    } else {
      if (autoUpload && !hasValidToken()) {
        logger.warn('autoUpload activado pero no hay token de YouTube. Video guardado localmente.');
      }
      emit('done', 100, '¡Video generado exitosamente!', { id, filePath: outputPath });
    }

    // Limpiar temp después del éxito
    await cleanTempDir(tempDir);

    return {
      success: true,
      id,
      title: story.title,
      filePath: outputPath,
      youtubeUrl: historyEntry.youtubeUrl,
      duration: historyEntry.duration,
    };

  } catch (error) {
    logger.error(`Pipeline falló: ${error.message}`);
    historyEntry.status = 'failed';
    historyEntry.error = error.message;
    saveToHistory(historyEntry);

    emit('error', 0, `Error: ${error.message}`, { error: error.message });

    // Limpiar temp también en error
    try { await cleanTempDir(tempDir); } catch {}

    throw error;
  }
}

/**
 * Iniciar el scheduler de publicación automática
 */
export function startScheduler() {
  const config = readConfig();

  if (!config.enabled) {
    logger.info('Scheduler desactivado en config.json');
    return;
  }

  if (activeTask) {
    activeTask.destroy();
    activeTask = null;
  }

  if (!cron.validate(config.cronExpression)) {
    logger.error(`Expresión cron inválida: ${config.cronExpression}`);
    return;
  }

  logger.ok(`Scheduler activado: "${config.cronExpression}"`);

  activeTask = cron.schedule(config.cronExpression, async () => {
    const cfg = readConfig();

    if (!cfg.enabled) {
      logger.info('Scheduler desactivado, omitiendo ejecución');
      return;
    }

    // Rotar categorías
    const category = cfg.categoryRotation[cfg.currentIndex % cfg.categoryRotation.length];
    cfg.currentIndex = (cfg.currentIndex + 1) % cfg.categoryRotation.length;
    writeConfig(cfg);

    logger.step(`[CRON] Iniciando generación automática — categoría: ${category}`);

    try {
      await runPipeline({
        category,
        voice: cfg.voice,
        autoUpload: cfg.autoUpload,
      });
      logger.ok('[CRON] Generación automática completada');
    } catch (error) {
      logger.error(`[CRON] Error en generación automática: ${error.message}`);
    }
  });
}

/**
 * Detener el scheduler
 */
export function stopScheduler() {
  if (activeTask) {
    activeTask.destroy();
    activeTask = null;
    logger.ok('Scheduler detenido');
  }
}

/**
 * Actualizar configuración del scheduler y reiniciarlo
 */
export function updateConfig(newConfig) {
  const current = readConfig();
  const updated = { ...current, ...newConfig };
  writeConfig(updated);

  // Reiniciar scheduler con nueva config
  stopScheduler();
  if (updated.enabled) {
    startScheduler();
  }

  return updated;
}

/**
 * Obtener estado actual del scheduler
 */
export function getSchedulerStatus() {
  const config = readConfig();
  return {
    ...config,
    isRunning: !!activeTask,
  };
}
