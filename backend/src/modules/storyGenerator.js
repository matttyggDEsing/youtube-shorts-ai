// ════════════════════════════════════════
// STORY GENERATOR — Generación de guiones con Groq / Llama 3.3
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { sleep } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

// Descripción de cada categoría para el prompt
const CATEGORIAS = {
  terror: 'casas embrujadas, entidades sobrenaturales, miedo psicológico, apariciones, maldiciones',
  misterio: 'casos sin resolver, conspiraciones gubernamentales, fenómenos inexplicables, desapariciones',
  motivacion: 'superación personal, historias de vida inspiradoras, resiliencia, éxito desde cero',
  romance: 'amor inesperado, destino y casualidades, encuentros fortuitos, historias de pareja',
  ciencia_ficcion: 'futuro distópico, inteligencia artificial, viajes espaciales, tecnología extrema',
  historias_reales: 'anécdotas curiosas y sorprendentes de la vida real, situaciones inusuales',
  leyendas: 'mitos urbanos latinoamericanos, folklore regional, leyendas populares de Latinoamérica',
  suspenso: 'thrillers psicológicos cortos, giros inesperados, tensión narrativa extrema',
};

/**
 * Generar guión completo de historia para un YouTube Short
 * @param {string} category - Categoría del video
 * @param {number} durationSeconds - Duración objetivo en segundos (default: 60)
 * @returns {Promise<Object>} Objeto con title, description, tags, scenes, fullNarration
 */
export async function generateStory(category = 'terror', durationSeconds = 60) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const descripcionCategoria = CATEGORIAS[category] || CATEGORIAS.terror;

  // Calcular cantidad de escenas según duración
  const minScenes = 6;
  const maxScenes = 10;
  const scenesCount = Math.min(maxScenes, Math.max(minScenes, Math.round(durationSeconds / 8)));

  const systemPrompt = `Eres un guionista experto en YouTube Shorts virales en español latinoamericano.
Tu única tarea es responder con un JSON válido y nada más. Sin markdown, sin explicaciones, sin backticks.
El JSON debe ser parseable directamente con JSON.parse().`;

  const userPrompt = `Crea un guión para un YouTube Short de categoría "${category}" (${descripcionCategoria}).

El video durará aproximadamente ${durationSeconds} segundos y debe tener exactamente ${scenesCount} escenas.

Devuelve ÚNICAMENTE este JSON (sin texto adicional, sin markdown):
{
  "title": "Título impactante para YouTube (máx 60 caracteres)",
  "description": "Descripción para YouTube (máximo 150 palabras). Incluir call to action para suscribirse.",
  "tags": ["etiqueta1", "etiqueta2", "etiqueta3", "etiqueta4", "etiqueta5", "shorts", "historias"],
  "scenes": [
    {
      "text": "Texto narrado de esta escena (máximo 30 palabras, lenguaje fluido y dramático)",
      "imagePrompt": "Detailed English prompt for AI image: scene description, cinematic style, lighting, mood, composition",
      "duration": 8
    }
  ],
  "fullNarration": "Texto completo de la narración, todo seguido sin separaciones"
}

REGLAS IMPORTANTES:
- El campo "text" de cada escena debe estar en español latinoamericano, narración en primera o tercera persona
- El campo "imagePrompt" SIEMPRE en inglés, descriptivo, cinematográfico, con estilo visual específico
- Las duraciones de todas las escenas sumadas deben dar aproximadamente ${durationSeconds} segundos
- La primera escena debe ser un gancho impactante que enganche en los primeros 3 segundos
- El "fullNarration" es la concatenación de todos los campos "text" de las escenas
- Los tags deben incluir términos relevantes en español para el algoritmo de YouTube
- El guión debe ser original, con giro narrativo en la última escena`;

  // Reintentar hasta 2 veces con backoff
  let lastError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      logger.step(`Generando historia (intento ${intento}/3)...`);

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 2000,
      });

      const rawContent = completion.choices[0]?.message?.content?.trim();
      if (!rawContent) throw new Error('Groq devolvió respuesta vacía');

      // Limpiar posibles restos de markdown por si el modelo los incluye
      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const story = JSON.parse(cleaned);

      // Validar estructura mínima
      if (!story.title || !story.scenes || !Array.isArray(story.scenes)) {
        throw new Error('El JSON de la historia tiene estructura inválida');
      }
      if (story.scenes.length < 3) {
        throw new Error(`Se esperaban al menos 6 escenas, se obtuvieron ${story.scenes.length}`);
      }

      logger.ok(`Historia generada: "${story.title}" — ${story.scenes.length} escenas`);
      return story;

    } catch (error) {
      lastError = error;
      logger.warn(`Error en intento ${intento}: ${error.message}`);
      if (intento < 3) {
        const backoff = intento * 2000; // 2s, 4s
        logger.info(`Esperando ${backoff / 1000}s antes de reintentar...`);
        await sleep(backoff);
      }
    }
  }

  throw new Error(`No se pudo generar la historia después de 3 intentos: ${lastError?.message}`);
}

/**
 * Devolver lista de categorías disponibles
 */
export function getCategories() {
  return Object.entries(CATEGORIAS).map(([id, desc]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replace('_', ' '),
    description: desc,
    emoji: {
      terror: '👻',
      misterio: '🔍',
      motivacion: '💪',
      romance: '❤️',
      ciencia_ficcion: '🚀',
      historias_reales: '📖',
      leyendas: '🌙',
      suspenso: '😰',
    }[id] || '📺',
  }));
}
