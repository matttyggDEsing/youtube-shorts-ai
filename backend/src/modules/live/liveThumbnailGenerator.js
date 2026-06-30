// ════════════════════════════════════════
// LIVE THUMBNAIL GENERATOR — Genera miniaturas para el directo con Sharp
// Diseños optimizados para CTR alto según nicho
// ════════════════════════════════════════

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dimensiones estándar de miniatura YouTube (1280×720 = 16:9)
const WIDTH  = 1280;
const HEIGHT = 720;

// Paletas por estilo/categoría
const PALETTES = {
  dark: {
    bg:        '#0a0a0f',
    accent:    '#ff2222',
    accent2:   '#ff6600',
    text:      '#ffffff',
    subtext:   '#cccccc',
    badge:     '#ff0000',
    overlay:   'rgba(0,0,0,0.55)',
  },
  lofi: {
    bg:        '#1a1525',
    accent:    '#a78bfa',
    accent2:   '#60a5fa',
    text:      '#f3f4f6',
    subtext:   '#c4b5fd',
    badge:     '#7c3aed',
    overlay:   'rgba(20,10,40,0.6)',
  },
  calm: {
    bg:        '#0d1b2a',
    accent:    '#38bdf8',
    accent2:   '#22d3ee',
    text:      '#f0f9ff',
    subtext:   '#bae6fd',
    badge:     '#0369a1',
    overlay:   'rgba(10,20,35,0.55)',
  },
  motivation: {
    bg:        '#111827',
    accent:    '#f59e0b',
    accent2:   '#fbbf24',
    text:      '#ffffff',
    subtext:   '#fde68a',
    badge:     '#d97706',
    overlay:   'rgba(0,0,0,0.5)',
  },
};

// Mapeo de categoría → estilo visual
const CATEGORY_STYLE = {
  terror_misterio: 'dark',
  musica_estudiar: 'calm',
  motivacion:      'motivation',
  musica_dormir:   'calm',
  lofi:            'lofi',
};

/**
 * Genera una miniatura para el directo de YouTube.
 *
 * @param {object} options
 * @param {string} options.title       - Título principal (máx ~25 chars visibles)
 * @param {string} options.category    - Categoría del directo
 * @param {string} options.style       - Forzar estilo: 'dark'|'lofi'|'calm'|'motivation' (opcional)
 * @param {string} options.outputPath  - Ruta completa donde guardar el PNG
 * @param {string} [options.emoji]     - Emoji decorativo (opcional)
 * @returns {Promise<string>}          - outputPath
 */
export async function generateLiveThumbnail({ title, category, style, outputPath, emoji }) {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const paletteName = style || CATEGORY_STYLE[category] || 'dark';
    const p = PALETTES[paletteName] ?? PALETTES['dark'];

    const icon = emoji || getCategoryEmoji(category);

    // Recortar título para que quepa en 2 líneas
    const lines = wrapText(title.toUpperCase(), 22);
    const line1 = lines[0] ?? '';
    const line2 = lines[1] ?? '';

    const svg = buildSVG({ p, icon, line1, line2, category });

    await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT)
      .png({ quality: 95 })
      .toFile(outputPath);

    logger.ok(`Thumbnail generado: ${outputPath}`);
    return outputPath;

  } catch (error) {
    logger.error(`liveThumbnailGenerator: ${error.message}`);
    throw error;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryEmoji(category) {
  const map = {
    terror_misterio: '👁',
    musica_estudiar: '📚',
    motivacion:      '🔥',
    musica_dormir:   '🌙',
    lofi:            '🎧',
  };
  return map[category] ?? '▶';
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length === 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  return lines;
}

function buildSVG({ p, icon, line1, line2, category }) {
  const categoryLabel = getCategoryLabel(category);

  // Posición vertical de las líneas de título
  const hasLine2   = line2.length > 0;
  const titleY1    = hasLine2 ? 320 : 370;
  const titleY2    = 400;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <!-- Fondo degradado -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${p.bg}" />
      <stop offset="100%" stop-color="${shiftColor(p.bg, 20)}" />
    </linearGradient>
    <!-- Degradado lateral izquierdo (elemento visual) -->
    <linearGradient id="side" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${p.accent}"  stop-opacity="0.9" />
      <stop offset="100%" stop-color="${p.accent2}" stop-opacity="0.7" />
    </linearGradient>
    <!-- Brillo central -->
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${p.accent}" stop-opacity="0.12" />
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0" />
    </radialGradient>
    <!-- Sombra texto -->
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.7"/>
    </filter>
    <filter id="glowFilter">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Fondo -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Brillo central -->
  <ellipse cx="${WIDTH / 2}" cy="${HEIGHT / 2}" rx="580" ry="350" fill="url(#glow)"/>

  <!-- Barra lateral izquierda (acento visual) -->
  <rect x="0" y="0" width="12" height="${HEIGHT}" fill="url(#side)"/>

  <!-- Líneas decorativas horizontales -->
  <line x1="60" y1="160" x2="550" y2="160" stroke="${p.accent}" stroke-width="2" stroke-opacity="0.4"/>
  <line x1="60" y1="530" x2="550" y2="530" stroke="${p.accent}" stroke-width="2" stroke-opacity="0.4"/>

  <!-- Badge EN VIVO -->
  <rect x="60" y="60" width="140" height="44" rx="8" fill="${p.badge}"/>
  <circle cx="84" cy="82" r="7" fill="#fff" opacity="0.9"/>
  <circle cx="84" cy="82" r="4" fill="${p.badge}">
    <animate attributeName="r" values="4;6;4" dur="1.4s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite"/>
  </circle>
  <text x="100" y="89" font-family="Arial Black, sans-serif" font-size="18" font-weight="900"
        fill="#fff" letter-spacing="2">EN VIVO</text>

  <!-- Icono / Emoji grande -->
  <text x="${WIDTH - 160}" y="${HEIGHT / 2 + 40}"
        font-family="Segoe UI Emoji, sans-serif" font-size="160" text-anchor="middle"
        dominant-baseline="middle" opacity="0.25">${icon}</text>

  <!-- Emoji visible -->
  <text x="90" y="230"
        font-family="Segoe UI Emoji, sans-serif" font-size="72" text-anchor="start"
        dominant-baseline="middle">${icon}</text>

  <!-- Línea 1 del título -->
  <text x="60" y="${titleY1}"
        font-family="Arial Black, Impact, sans-serif"
        font-size="88" font-weight="900"
        fill="${p.text}" filter="url(#shadow)"
        letter-spacing="-2">${escapeXml(line1)}</text>

  <!-- Línea 2 del título (si existe) -->
  ${hasLine2 ? `<text x="60" y="${titleY2 + 30}"
        font-family="Arial Black, Impact, sans-serif"
        font-size="88" font-weight="900"
        fill="${p.accent}" filter="url(#shadow)"
        letter-spacing="-2">${escapeXml(line2)}</text>` : ''}

  <!-- Subtítulo de categoría -->
  <text x="60" y="${HEIGHT - 55}"
        font-family="Arial, sans-serif" font-size="28" font-weight="700"
        fill="${p.subtext}" letter-spacing="3" opacity="0.8">${categoryLabel}</text>

  <!-- Punto decorativo -->
  <circle cx="${WIDTH - 60}" cy="${HEIGHT - 60}" r="40"
          fill="${p.accent}" opacity="0.15"/>
  <circle cx="${WIDTH - 60}" cy="${HEIGHT - 60}" r="20"
          fill="${p.accent}" opacity="0.3"/>
</svg>`;
}

function getCategoryLabel(category) {
  const map = {
    terror_misterio: '🎙 HISTORIAS • TERROR • MISTERIO',
    musica_estudiar: '🎵 MÚSICA PARA ESTUDIAR & TRABAJAR',
    motivacion:      '💪 FRASES & MOTIVACIÓN CONTINUA',
    musica_dormir:   '🌙 MÚSICA PARA DORMIR & RELAJAR',
    lofi:            '🎧 LOFI BEATS • CHILL • AMBIENT',
  };
  return map[category] ?? '▶ DIRECTO EN VIVO';
}

function escapeXml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

/** Aclara/oscurece un color hex para el degradado de fondo */
function shiftColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r   = Math.min(255, ((num >> 16) & 0xff) + amount);
  const g   = Math.min(255, ((num >> 8)  & 0xff) + amount);
  const b   = Math.min(255, ( num        & 0xff) + amount);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
