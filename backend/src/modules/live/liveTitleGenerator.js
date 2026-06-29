// ════════════════════════════════════════
// LIVE TITLE GENERATOR
// Genera títulos con alto CTR para directos
// usando Groq / Llama 3.3
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { logger } from '../../utils/logger.js';

// ── Plantillas base por categoría ────────────────────────────
const TITLE_TEMPLATES = {
  terror_misterio: [
    '🔴 EN VIVO | {keyword} en Español • No Escuches Solo de Noche',
    '👻 DIRECTO | Las Mejores {keyword} de Latinoamérica • {duration}h',
    '🔴 {keyword} SIN PARAR | {duration} Horas Seguidas en Español',
    '🔴 EN VIVO | Historias de {keyword} • Maratón Nocturna',
  ],
  musica_estudiar: [
    '🔴 EN VIVO | Música para Estudiar {duration}h • Sin Distracciones',
    '🎵 LOFI EN ESPAÑOL 24/7 🔴 | Estudiar, Trabajar y Concentrarse',
    '🔴 Música para Estudiar • {duration} Horas de Concentración Total',
    '📚 EN VIVO | {keyword} para Estudiar y Trabajar en Español',
  ],
  musica_dormir: [
    '😴 EN VIVO | Música para Dormir {duration}h • Relajación Profunda',
    '🔴 DIRECTO | Sonidos para Dormir • {duration} Horas sin Interrupciones',
    '🌙 EN VIVO | {keyword} para Dormir Profundamente en Español',
    '🔴 Música Relajante {duration}h | Para Dormir y Descansar',
  ],
  motivacion: [
    '🔴 EN VIVO | Frases que Cambian Vidas • Motivación {duration}h',
    '💪 DIRECTO | {keyword} en Español • Mentalidad Ganadora',
    '🔴 Motivación Continua {duration}h | Para Emprendedores y Soñadores',
    '🌟 EN VIVO | {keyword} • El Combustible que Necesitás Hoy',
  ],
  lofi: [
    '🎵 LOFI EN VIVO 🔴 | {duration}h de Beats para Estudiar y Relajarse',
    '🔴 EN VIVO | Lofi Hip Hop en Español • Lluvia y Café ☕',
    '☕ DIRECTO LOFI | {keyword} • Música Ambiental en Español',
    '🔴 Lofi {duration}h | Beats Relajantes para Estudiar y Trabajar',
  ],
  lluvia: [
    '🌧️ EN VIVO | Sonidos de Lluvia {duration}h • Para Dormir y Concentrarse',
    '🔴 DIRECTO | Lluvia Relajante • {duration} Horas de Paz',
    '🌧️ Lluvia y {keyword} 🔴 | {duration}h para Estudiar y Dormir',
    '🔴 EN VIVO | Lluvia Suave • Sonidos para Relajarse en Español',
  ],
  naturaleza: [
    '🌿 EN VIVO | Sonidos de Naturaleza {duration}h • Paz y Tranquilidad',
    '🔴 DIRECTO | {keyword} • Meditación y Relajación Natural',
    '🌊 EN VIVO | {keyword} Relajante • {duration} Horas de Naturaleza',
    '🔴 Naturaleza {duration}h | Sonidos para Meditar y Dormir',
  ],
  curiosidades: [
    '🔴 EN VIVO | Curiosidades Increíbles • {duration}h Sin Parar',
    '🤯 DIRECTO | {keyword} que Nadie te Contó • En Español',
    '🔴 Datos Curiosos {duration}h | Lo más Sorprendente del Mundo',
    '🧠 EN VIVO | {keyword} • ¿Cuántos Conocías? en Español',
  ],
};

// ── Palabras clave por categoría para el contexto ────────────
const CATEGORY_KEYWORDS = {
  terror_misterio:  ['Terror', 'Misterio', 'Historias de Terror', 'Leyendas', 'Suspenso'],
  musica_estudiar:  ['Música', 'Lofi', 'Piano Ambiental', 'Jazz', 'Instrumental'],
  musica_dormir:    ['Música Relajante', 'Sonidos', 'Meditación', 'Piano Suave', 'Naturaleza'],
  motivacion:       ['Motivación', 'Frases Poderosas', 'Mentalidad', 'Éxito', 'Inspiración'],
  lofi:             ['Lofi', 'Beats', 'Hip Hop Relajante', 'Café', 'Lluvia'],
  lluvia:           ['Lluvia', 'Tormenta Suave', 'Lluvia en Cafetería', 'Lluvia Nocturna'],
  naturaleza:       ['Naturaleza', 'Océano', 'Bosque', 'Pájaros', 'Olas del Mar'],
  curiosidades:     ['Curiosidades', 'Datos Curiosos', 'Hechos Increíbles', 'Misterios'],
};

// ── Evaluador de calidad de título ───────────────────────────
function scoreTitulo(titulo) {
  let score = 0;

  // Tiene emoji al inicio
  if (/^\p{Emoji}/u.test(titulo)) score += 20;

  // Contiene "EN VIVO" o "DIRECTO"
  if (/EN VIVO|DIRECTO/i.test(titulo)) score += 20;

  // Longitud ideal (45–65 caracteres)
  const len = titulo.length;
  if (len >= 45 && len <= 65) score += 30;
  else if (len >= 35 && len < 45) score += 15;
  else if (len > 65 && len <= 75) score += 10;

  // Contiene número (horas, cantidad)
  if (/\d+/.test(titulo)) score += 10;

  // Contiene palabra emocional
  const emocionales = ['Increíble', 'Solo', 'Noche', 'Profund', 'Sin Parar', 'Maratón',
    'Relajante', 'Poderosa', 'Cambia', 'Nunca', 'Mejor', 'Total'];
  if (emocionales.some(p => titulo.toLowerCase().includes(p.toLowerCase()))) score += 20;

  return score;
}

// ── Función principal ─────────────────────────────────────────
/**
 * Genera títulos con alto CTR para un directo de YouTube.
 * @param {string} category  — Categoría del directo (terror_misterio, lofi, etc.)
 * @param {string[]} keywords — Palabras clave adicionales
 * @param {number} durationHours — Duración del directo en horas
 * @returns {Promise<string[]>} — Array de títulos ordenados por score
 */
export async function generateLiveTitle(category, keywords = [], durationHours = 8) {
  logger.step(`Generando títulos para directo: ${category}`);

  const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const templates  = TITLE_TEMPLATES[category] || TITLE_TEMPLATES.musica_estudiar;
  const catKeywords = CATEGORY_KEYWORDS[category] || keywords;
  const allKeywords = [...new Set([...catKeywords, ...keywords])].slice(0, 6);

  const promptSeed = `[seed:${Date.now()}]`;

  const prompt = `${promptSeed}
Generá exactamente 5 títulos para un directo de YouTube de ${durationHours} horas sobre "${allKeywords.join(', ')}".
Categoría: ${category}

REGLAS ESTRICTAS:
- Máximo 70 caracteres por título
- Iniciar con emoji relevante
- Incluir "EN VIVO" o "DIRECTO" en mayúsculas
- Incluir la duración "${durationHours}h" en al menos 2 títulos
- Español latinoamericano, lenguaje cercano y directo
- Generar curiosidad o transmitir el beneficio en segundos
- NO repetir la misma estructura dos veces

PLANTILLAS DE REFERENCIA (adaptá, no copies literalmente):
${templates.join('\n')}

Respondé SOLO con los 5 títulos, uno por línea, sin numeración ni explicaciones.`;

  try {
    const completion = await groq.chat.completions.create({
      model:      'llama-3.3-70b-versatile',
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.85,
    });

    const raw    = completion.choices[0].message.content.trim();
    const titulos = raw
      .split('\n')
      .map(t => t.trim())
      .filter(t => t.length > 20 && t.length <= 75)
      .slice(0, 5);

    if (titulos.length === 0) {
      throw new Error('Groq no devolvió títulos válidos');
    }

    // Ordenar por score de calidad
    const ordenados = titulos.sort((a, b) => scoreTitulo(b) - scoreTitulo(a));

    logger.ok(`Títulos generados (${ordenados.length}):`);
    ordenados.forEach((t, i) => logger.info(`  ${i + 1}. [${scoreTitulo(t)}pts] ${t}`));

    return ordenados;

  } catch (error) {
    logger.warn(`Error generando títulos con Groq: ${error.message}. Usando fallback.`);

    // Fallback: usar plantillas locales
    const fallback = templates
      .map(t =>
        t
          .replace('{keyword}', allKeywords[0] || 'Contenido')
          .replace('{duration}', String(durationHours))
      )
      .slice(0, 3);

    return fallback;
  }
}

/**
 * Genera el título final más corto para la miniatura (3–4 palabras).
 * @param {string} fullTitle — Título largo del directo
 * @returns {string}
 */
export function extractThumbnailTitle(fullTitle) {
  // Quitar emojis y etiquetas como "EN VIVO |"
  const clean = fullTitle
    .replace(/[\p{Emoji}\u200d]+/gu, '')
    .replace(/EN VIVO\s*\|?/i, '')
    .replace(/DIRECTO\s*\|?/i, '')
    .trim();

  // Tomar las primeras 3–4 palabras significativas
  const palabras = clean.split(' ').filter(p => p.length > 2).slice(0, 4);
  return palabras.join(' ');
}
