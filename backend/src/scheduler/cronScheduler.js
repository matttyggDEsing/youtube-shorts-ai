// ════════════════════════════════════════
// CRON SCHEDULER v2 — Pipeline con B-roll real de Pexels
// Fix #7: updateConfig ya no reinicia el scheduler si hay un pipeline activo
// ════════════════════════════════════════

import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { generateStory } from '../modules/storyGenerator.js';
import { generateNarration } from '../modules/ttsNarrator.js';
import { fetchSceneVideos } from '../modules/videoFetcher.js';
import { createShort } from '../modules/videoEditor.js';
import { uploadToYoutube, hasValidToken } from '../modules/youtubeUploader.js';
import { generateOutputFilename, saveToHistory, cleanTempDir } from '../utils/fileManager.js';

const CONFIG_PATH = './config.json';
let activeTask    = null;

// FIX #7: flag para saber si hay un pipeline corriendo
// antes de reiniciar el scheduler desde updateConfig
let pipelineRunning = false;

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaultConfig = {
        enabled:          false,
        cronExpression:   '0 18 * * *',
        categoryRotation: ['terror', 'misterio', 'motivacion'],
        currentIndex:     0,
        autoUpload:       true,
        voice:            'es-AR-ElenaNeural',
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { enabled: false };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Pipeline completo: historia → TTS → B-roll Pexels → video → (upload)
 */
export async function runPipeline({ category, voice, autoUpload = false, onProgress = null }) {
  const id      = uuidv4();
  const tempDir = `./temp/${id}`;
  fs.mkdirSync(tempDir, { recursive: true });

  const emit = (step, progress, message, extra = {}) => {
    logger.step(`[${step}] ${message}`);
    if (onProgress) onProgress({ step, progress, message, ...extra });
  };

  let historyEntry = {
    id,
    title:      '',
    category,
    filePath:   '',
    youtubeUrl: null,
    status:     'processing',
    createdAt:  new Date().toISOString(),
    duration:   0,
  };

  pipelineRunning = true;

  try {
    // ── PASO 1: Generar historia con Groq ────────────────────
    emit('story', 10, 'Generando historia con IA...');
    const story = await generateStory(category, 55);
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

    // ── PASO 3: Descargar B-roll de Pexels ───────────────────
    emit('images', 45, 'Descargando clips cinematográficos de Pexels...');
    const clipsDir = path.join(tempDir, 'clips');
    const rawClips = await fetchSceneVideos(story.scenes, clipsDir, category);

    // ── PASO 4: Montar video ──────────────────────────────────
    emit('video', 70, 'Montando video con efectos y subtítulos...');
    const outputFilename = generateOutputFilename(category, story.title);
    const outputPath     = path.join(process.env.OUTPUT_DIR || './output', outputFilename);

    await createShort(
      story.scenes,
      rawClips,
      audioPath,
      vttPath,
      outputPath,
      story.title
    );

    historyEntry.filePath    = outputPath;
    historyEntry.status      = 'local';
    historyEntry.description = story.description;
    historyEntry.tags        = story.tags;
    saveToHistory(historyEntry);

    // ── PASO 5: Subir a YouTube (opcional) ───────────────────
    if (autoUpload && hasValidToken()) {
      emit('upload', 88, 'Subiendo a YouTube...');
      try {
        const { videoId, url } = await uploadToYoutube(outputPath, {
          title:       story.title,
          description: story.description || `${story.title} #Shorts`,
          tags:        story.tags || ['shorts', 'historias'],
          categoryId:  '24',
        });
        historyEntry.youtubeUrl = url;
        historyEntry.youtubeId  = videoId;
        historyEntry.status     = 'uploaded';
        saveToHistory(historyEntry);
      } catch (uploadError) {
        logger.warn(`Error al subir a YouTube: ${uploadError.message}`);
      }
    }

    // ── Limpiar temp ──────────────────────────────────────────
    try { cleanTempDir(tempDir); } catch { /* no crítico */ }

    emit('done', 100, '¡Short listo!', {
      videoPath:       outputPath,
      url:             historyEntry.youtubeUrl,
      title:           story.title,
      durationSeconds,
    });

    return historyEntry;

  } catch (error) {
    historyEntry.status = 'failed';
    historyEntry.error  = error.message;
    saveToHistory(historyEntry);
    try { cleanTempDir(tempDir); } catch { /* no crítico */ }
    throw error;

  } finally {
    // Siempre liberar el flag al terminar, con éxito o con error
    pipelineRunning = false;
  }
}

export function getSchedulerStatus() {
  const cfg = readConfig();
  return {
    enabled:          cfg.enabled,
    cronExpression:   cfg.cronExpression,
    categoryRotation: cfg.categoryRotation,
    currentIndex:     cfg.currentIndex,
    autoUpload:       cfg.autoUpload,
    voice:            cfg.voice,
    nextRun:          activeTask ? 'programado' : 'inactivo',
    pipelineRunning,
  };
}

/**
 * FIX #7: updateConfig ya no reinicia el scheduler mientras haya
 * un pipeline activo. La nueva config se guarda en disco y se aplicará
 * en el próximo ciclo del cron sin interrumpir la generación en curso.
 */
export function updateConfig(newConfig) {
  const cfg = { ...readConfig(), ...newConfig };
  writeConfig(cfg);

  if (pipelineRunning) {
    logger.warn('Pipeline activo — la nueva configuración del scheduler se aplicará al terminar.');
  } else {
    startScheduler();
  }

  return getSchedulerStatus();
}

export function startScheduler() {
  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }

  const cfg = readConfig();
  if (!cfg.enabled || !cfg.cronExpression) {
    logger.info('Scheduler desactivado.');
    return;
  }

  if (!cron.validate(cfg.cronExpression)) {
    logger.warn(`Expresión cron inválida: ${cfg.cronExpression}`);
    return;
  }

  activeTask = cron.schedule(cfg.cronExpression, async () => {
    // FIX #7: si ya hay un pipeline corriendo cuando dispara el cron,
    // saltear este ciclo en lugar de iniciar uno paralelo
    if (pipelineRunning) {
      logger.warn('Scheduler: pipeline ya activo, saltando este ciclo.');
      return;
    }

    const rotation = cfg.categoryRotation || ['terror'];
    const index    = (cfg.currentIndex || 0) % rotation.length;
    const category = rotation[index];

    logger.ok(`Scheduler: generando Short de categoría "${category}"...`);
    writeConfig({ ...cfg, currentIndex: (index + 1) % rotation.length });

    try {
      await runPipeline({
        category,
        voice:      cfg.voice || 'es-AR-ElenaNeural',
        autoUpload: cfg.autoUpload ?? true,
      });
    } catch (err) {
      logger.error(`Scheduler: error en pipeline — ${err.message}`);
    }
  });

  logger.ok(`Scheduler activo: ${cfg.cronExpression}`);
}
