// ════════════════════════════════════════
// SERVER.JS — Servidor principal Express
// YouTube Shorts AI Automation
// ════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { ensureDirectories } from './src/utils/fileManager.js';
import { startScheduler } from './src/scheduler/cronScheduler.js';
import { getCategories } from './src/modules/storyGenerator.js';
import { logger } from './src/utils/logger.js';

// Rutas
import generateRoutes from './src/routes/generate.js';
import historyRoutes  from './src/routes/history.js';
import scheduleRoutes from './src/routes/schedule.js';
import youtubeRoutes  from './src/routes/youtube.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// ── Middleware ────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas API ─────────────────────────────────────────────
app.use('/api/generate',  generateRoutes);
app.use('/api/history',   historyRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/youtube',   youtubeRoutes);

// Categorías disponibles
app.get('/api/categories', (req, res) => {
  res.json({ success: true, categories: getCategories() });
});

// Voces disponibles
app.get('/api/voices', (req, res) => {
  res.json({
    success: true,
    voices: [
      { id: 'es-AR-ElenaNeural',  name: 'Elena',  accent: 'Argentina', gender: 'F' },
      { id: 'es-MX-DaliaNeural',  name: 'Dalia',  accent: 'México',    gender: 'F' },
      { id: 'es-ES-AlvaroNeural', name: 'Álvaro', accent: 'España',    gender: 'M' },
      { id: 'es-MX-JorgeNeural',  name: 'Jorge',  accent: 'México',    gender: 'M' },
    ],
  });
});

// Estado general del sistema
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    version: '1.0.0',
    groqConfigured: !!process.env.GROQ_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// Videos generados — servir archivos MP4
app.use('/output', express.static(path.join(__dirname, 'output')));

// Fallback → servir index.html para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Manejo de errores global ──────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Error no controlado: ${err.message}`);
  res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

// ── Arranque ──────────────────────────────────────────────
async function init() {
  // Crear directorios necesarios
  ensureDirectories();

  // Iniciar servidor
  app.listen(PORT, () => {
    logger.ok(`════════════════════════════════════════`);
    logger.ok(`  YouTube Shorts AI — Puerto ${PORT}`);
    logger.ok(`  http://localhost:${PORT}`);
    logger.ok(`════════════════════════════════════════`);

    if (!process.env.GROQ_API_KEY) {
      logger.warn('GROQ_API_KEY no configurada. Configúrala en .env para generar historias.');
    }
  });

  // Iniciar scheduler de publicación automática
  startScheduler();
}

init().catch((error) => {
  logger.error(`Error fatal al iniciar: ${error.message}`);
  process.exit(1);
});
