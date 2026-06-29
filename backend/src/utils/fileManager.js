// ════════════════════════════════════════
// FILE MANAGER — Gestión de archivos y directorios
// Fix #6: cleanTempDir era async sin necesidad — convertida a síncrona
// + Loop: agregadas deleteVideoFile, updateHistoryEntry, writeHistory, addHistoryEntry
// ════════════════════════════════════════
import fs from 'fs';
import fsP from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Directorios ──────────────────────────────────────────────────────────────

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

// ─── Nombres de archivo ───────────────────────────────────────────────────────

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

// ─── Temp ─────────────────────────────────────────────────────────────────────

/**
 * Limpiar directorio temporal después de una generación exitosa.
 * FIX #6: era async pero solo usaba fs síncrono — convertida a función síncrona.
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

// ─── Historial (API síncrona — original) ─────────────────────────────────────

const HISTORY_PATH = './logs/history.json';

/**
 * Leer historial de videos generados
 */
export function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) {
      fs.writeFileSync(HISTORY_PATH, '[]', 'utf8');
    }
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
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
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Obtener entrada del historial por ID
 */
export function getHistoryEntry(id) {
  const history = readHistory();
  return history.find(h => h.id === id) || null;
}

// ─── Historial (helpers async — usados por loopManager) ──────────────────────

/**
 * Escribe el historial completo (async).
 */
export async function writeHistory(history) {
  await fsP.mkdir(path.dirname(path.resolve(HISTORY_PATH)), { recursive: true });
  await fsP.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Agrega una entrada al inicio del historial (async).
 */
export async function addHistoryEntry(entry) {
  const history = readHistory();
  history.unshift(entry);
  await writeHistory(history);
}

/**
 * Actualiza campos de una entrada existente por ID (async).
 */
export async function updateHistoryEntry(id, updates) {
  const history = readHistory();
  const index   = history.findIndex((e) => e.id === id);
  if (index === -1) return false;
  history[index] = { ...history[index], ...updates };
  await writeHistory(history);
  return true;
}

// ─── Limpieza de MP4 locales (loop) ──────────────────────────────────────────

/**
 * Elimina el archivo MP4 local tras confirmar subida a YouTube.
 * Actualiza el historial: fileDeleted = true, filePath = "".
 *
 * @param {string} filePath  - Ruta del archivo (relativa o absoluta)
 * @param {string} [entryId] - ID del entry en el historial
 * @returns {Promise<{ deleted: boolean, reason?: string }>}
 */
export async function deleteVideoFile(filePath, entryId) {
  if (!filePath) {
    return { deleted: false, reason: 'filePath vacío o nulo' };
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(__dirname, '../../', filePath);

  try {
    await fsP.access(absolutePath);
  } catch {
    if (entryId) {
      await updateHistoryEntry(entryId, { fileDeleted: true, filePath: '' }).catch(() => {});
    }
    return { deleted: false, reason: `Archivo no encontrado: ${absolutePath}` };
  }

  await fsP.unlink(absolutePath);

  if (entryId) {
    await updateHistoryEntry(entryId, { fileDeleted: true, filePath: '' }).catch(() => {});
  }

  logger.ok(`Archivo local eliminado: ${absolutePath}`);
  return { deleted: true };
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Espera N milisegundos (útil para backoff)
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
