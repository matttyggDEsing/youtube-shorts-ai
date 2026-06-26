// ════════════════════════════════════════
// FILE MANAGER — Gestión de archivos y directorios
// Fix #6: cleanTempDir era async sin necesidad — convertida a síncrona
// ════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * Crear directorios necesarios al arrancar la app
 */
export function ensureDirectories() {
  const dirs = ['./output', './temp', './logs', './credentials'];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  logger.ok('Directorios de trabajo verificados.');
}

/**
 * Convertir texto a slug válido para nombre de archivo
 * Ejemplo: "La Casa del Fin del Mundo" → "la-casa-del-fin-del-mundo"
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')   // solo alfanumérico
    .trim()
    .replace(/\s+/g, '-')           // espacios → guiones
    .replace(/-+/g, '-')            // guiones dobles → uno
    .substring(0, 50);              // máximo 50 chars
}

/**
 * Generar nombre de archivo de video final
 * Ejemplo: 20240615_183045_terror_la-casa.mp4
 */
export function generateOutputFilename(category, title) {
  const now = new Date();
  const ts  = now.toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+/, '')
    .substring(0, 15);
  const slug = slugify(title);
  return `${ts}_${category}_${slug}.mp4`;
}

/**
 * Limpiar directorio temporal después de una generación exitosa.
 * FIX #6: era async pero solo usaba fs síncrono — convertida a función síncrona.
 * El pipeline la llamaba con await, lo que funcionaba pero era innecesario y confuso.
 */
export function cleanTempDir(tempDir) {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat     = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
    logger.ok(`Directorio temporal limpiado: ${tempDir}`);
  } catch (error) {
    logger.warn(`No se pudo limpiar temp: ${error.message}`);
  }
}

/**
 * Leer historial de videos generados
 */
export function readHistory() {
  const histPath = './logs/history.json';
  try {
    if (!fs.existsSync(histPath)) {
      fs.writeFileSync(histPath, '[]', 'utf8');
    }
    return JSON.parse(fs.readFileSync(histPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Guardar entrada en historial
 */
export function saveToHistory(entry) {
  const history = readHistory();
  const idx     = history.findIndex(h => h.id === entry.id);
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...entry };
  } else {
    history.unshift(entry); // más recientes primero
  }
  fs.writeFileSync('./logs/history.json', JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Obtener entrada del historial por ID
 */
export function getHistoryEntry(id) {
  const history = readHistory();
  return history.find(h => h.id === id) || null;
}

/**
 * Espera N milisegundos (útil para backoff)
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
