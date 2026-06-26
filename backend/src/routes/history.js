// ════════════════════════════════════════
// ROUTE: /api/history — Historial de videos generados
// ════════════════════════════════════════

import { Router } from 'express';
import { readHistory, getHistoryEntry } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/history
 * Devuelve el historial completo de videos generados
 */
router.get('/', (req, res) => {
  try {
    const history = readHistory();
    res.json({ success: true, history });
  } catch (error) {
    logger.error(`Error leyendo historial: ${error.message}`);
    res.status(500).json({ success: false, error: 'No se pudo leer el historial' });
  }
});

/**
 * GET /api/history/:id
 * Devuelve una entrada específica del historial
 */
router.get('/:id', (req, res) => {
  try {
    const entry = getHistoryEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, error: 'Video no encontrado en el historial' });
    }
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/categories
 * Lista de categorías disponibles (también disponible desde aquí)
 */
router.get('/meta/categories', (req, res) => {
  res.json({
    success: true,
    categories: [
      { id: 'terror',          name: 'Terror',            emoji: '👻' },
      { id: 'misterio',        name: 'Misterio',          emoji: '🔍' },
      { id: 'motivacion',      name: 'Motivación',        emoji: '💪' },
      { id: 'romance',         name: 'Romance',           emoji: '❤️' },
      { id: 'ciencia_ficcion', name: 'Ciencia Ficción',   emoji: '🚀' },
      { id: 'historias_reales',name: 'Historias Reales',  emoji: '📖' },
      { id: 'leyendas',        name: 'Leyendas',          emoji: '🌙' },
      { id: 'suspenso',        name: 'Suspenso',          emoji: '😰' },
    ],
  });
});

export default router;
