// ════════════════════════════════════════
// LIVE TAGS GENERATOR — Genera tags SEO para el directo
// Usa Groq/Llama igual que el resto del sistema
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { logger } from '../../utils/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Tags base por categoría (fallback si Groq falla)
const BASE_TAGS = {
  terror_misterio: [
    'terror', 'misterio', 'horror', 'suspenso', 'historias de terror',
    'historias reales', 'miedo', 'paranormal', 'crimen real', 'relatos de terror',
    'musica de terror', 'ambiente oscuro', 'noche', 'escalofriante',
  ],
  musica_estudiar: [
    'música para estudiar', 'concentración', 'focus', 'estudio', 'productividad',
    'música ambiental', 'lofi', 'beats para estudiar', 'sin letra', 'música relajante',
    'trabajo', 'música de fondo', 'estudiantes', 'exámenes',
  ],
  motivacion: [
    'motivación', 'frases motivadoras', 'superación personal', 'éxito', 'inspiración',
    'mentalidad ganadora', 'citas de éxito', 'crecimiento personal', 'autoayuda',
    'mindset', 'metas', 'disciplina', 'fuerza mental',
  ],
  musica_dormir: [
    'música para dormir', 'sonidos relajantes', 'dormir profundo', 'insomnio',
    'relajación', 'meditación', 'descanso', 'sueño profundo', 'calma',
    'sonidos de la naturaleza', 'lluvia para dormir', 'piano relajante', 'bienestar',
  ],
  lofi: [
    'lofi', 'lofi hip hop', 'lofi beats', 'chill beats', 'lofi música',
    'lofi en español', 'lofi para estudiar', 'chill music', 'beats relajantes',
    'lofi chill', 'música chill', 'ambiente lofi', 'beats tranquilos',
  ],
};

// Tags universales que siempre se añaden
const UNIVERSAL_TAGS = [
  'directo', 'en vivo', 'live', '24 horas', 'streaming', 'música continua',
];

/**
 * Genera tags optimizados para SEO de YouTube usando Groq.
 * Devuelve un array de máximo 500 caracteres en total (límite de YouTube).
 *
 * @param {string} category  - Categoría del directo
 * @param {string} title     - Título del directo (para contexto)
 * @returns {Promise<string[]>}
 */
export async function generateLiveTags(category, title) {
  try {
    const prompt = `Genera exactamente 15 tags SEO en español para un directo de YouTube.
Categoría: ${category}
Título del directo: "${title}"

Reglas:
- En español (algunos en inglés si aplica al nicho)
- Mezcla: keywords generales + específicos + long-tail
- Sin hashtags (#), sin comillas, solo las palabras
- Un tag por línea
- Máximo 30 caracteres por tag
- Priorizá términos que la gente realmente busca en YouTube

Devuelve SOLO los tags, uno por línea, sin numeración ni explicaciones.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const aiTags = raw
      .split('\n')
      .map(t => t.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter(t => t.length > 0 && t.length <= 30)
      .slice(0, 15);

    const baseTags = BASE_TAGS[category] ?? BASE_TAGS['musica_estudiar'];

    // Combinar: AI tags + universales + base, deduplicar
    const combined = [...new Set([...aiTags, ...UNIVERSAL_TAGS, ...baseTags])];

    // YouTube permite hasta 500 caracteres total en tags
    return trimTagsToLimit(combined, 500);

  } catch (error) {
    logger.warn(`liveTagsGenerator: Groq falló, usando tags base. ${error.message}`);
    const base = BASE_TAGS[category] ?? BASE_TAGS['musica_estudiar'];
    return trimTagsToLimit([...UNIVERSAL_TAGS, ...base], 500);
  }
}

/**
 * Recorta el array de tags para que su longitud total
 * (contando comas y espacios de separación) no supere el límite.
 */
function trimTagsToLimit(tags, maxChars) {
  const result = [];
  let total = 0;

  for (const tag of tags) {
    const addition = result.length === 0 ? tag.length : tag.length + 2; // ", "
    if (total + addition > maxChars) break;
    result.push(tag);
    total += addition;
  }

  return result;
}
