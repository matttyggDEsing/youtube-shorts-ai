// ════════════════════════════════════════
// STORY GENERATOR — Generación de guiones con Groq / Llama 3.3
// v2: videoKeywords para Pexels B-roll + gancho emocional + cliffhanger final
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { sleep } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

const CATEGORIAS = {
  terror:           'casas embrujadas, entidades sobrenaturales, miedo psicológico, apariciones, maldiciones',
  misterio:         'casos sin resolver, conspiraciones gubernamentales, fenómenos inexplicables, desapariciones',
  motivacion:       'superación personal, historias de vida inspiradoras, resiliencia, éxito desde cero',
  romance:          'amor inesperado, destino y casualidades, encuentros fortuitos, historias de pareja',
  ciencia_ficcion:  'futuro distópico, inteligencia artificial, viajes espaciales, tecnología extrema',
  historias_reales: 'anécdotas curiosas y sorprendentes de la vida real, situaciones inusuales',
  leyendas:         'mitos urbanos latinoamericanos, folklore regional, leyendas populares de Latinoamérica',
  suspenso:         'thrillers psicológicos cortos, giros inesperados, tensión narrativa extrema',
};

/**
 * Generar guión completo de historia para un YouTube Short
 * @param {string} category - Categoría del video
 * @param {number} durationSeconds - Duración objetivo en segundos (default: 55)
 * @returns {Promise<Object>} title, description, tags, scenes, fullNarration
 */
export async function generateStory(category = 'terror', durationSeconds = 55) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const descripcionCategoria = CATEGORIAS[category] || CATEGORIAS.terror;

  // Más escenas = más cortes = más retención
  // Cada escena dura ~2-3s de narración, con múltiples clips de 1-2s por escena
  const minScenes = 8;
  const maxScenes = 14;
  const scenesCount = Math.min(maxScenes, Math.max(minScenes, Math.round(durationSeconds / 5)));

  const systemPrompt = `Eres un guionista experto en YouTube Shorts virales en español latinoamericano.
Creás historias adictivas con ritmo frenético, narración emocional en primera persona y ganchos narrativos.
Tu única tarea es responder con un JSON válido y nada más. Sin markdown, sin explicaciones, sin backticks.`;

  const userPrompt = `Creá un guión para un YouTube Short VIRAL de categoría "${category}" (${descripcionCategoria}).

El video dura exactamente ${durationSeconds} segundos y tiene ${scenesCount} escenas.

ESTILO OBLIGATORIO:
- Narración en PRIMERA PERSONA, voz íntima y emocional, como si le contaras un secreto al espectador
- Primera frase: gancho BRUTAL que genere curiosidad o impacto en menos de 5 palabras
- Ritmo frenético: frases cortas, potentes, que dejen al espectador sin aliento
- Cada escena termina con tensión que obliga a seguir escuchando
- La ÚLTIMA escena SIEMPRE termina en cliffhanger o pregunta que deje en suspenso ("¿Pero quién era realmente...?", "Lo que descubrí después cambió todo...", "Y entonces lo vi.")
- Lenguaje coloquial latinoamericano, cercano, real

Para el campo "videoKeywords" de cada escena: términos en INGLÉS para buscar B-roll cinematográfico en Pexels.
Ejemplos de buenos keywords: "coffee pouring slow motion", "rain window night", "hands trembling close up", "city lights bokeh", "candle flame dark", "woman crying close up", "empty road fog", "clock ticking macro".
Los keywords deben COMPLEMENTAR la emoción de la escena sin mostrar nada específico de la trama.

Devolvé ÚNICAMENTE este JSON (sin texto extra, sin markdown):
{
  "title": "Título impactante para YouTube (máx 60 caracteres, genera curiosidad)",
  "description": "Descripción para YouTube (máximo 150 palabras). Incluir call to action para suscribirse y ver la parte 2.",
  "tags": ["etiqueta1", "etiqueta2", "etiqueta3", "etiqueta4", "etiqueta5", "shorts", "historias"],
  "scenes": [
    {
      "text": "Texto narrado de esta escena. Máximo 20 palabras. Frase corta e impactante.",
      "videoKeywords": ["cinematic keyword 1", "cinematic keyword 2"],
      "duration": 4,
      "emotion": "tension|sadness|fear|hope|love|shock"
    }
  ],
  "fullNarration": "Texto completo de la narración, todo seguido sin separaciones"
}

REGLAS:
- "text" en español latinoamericano, máximo 20 palabras por escena, frases cortadas con drama
- "videoKeywords" en inglés, 2 opciones por escena, descriptivos para B-roll cinematográfico
- Las duraciones sumadas deben dar ~${durationSeconds} segundos
- Primera escena: gancho en menos de 5 palabras ("Esa noche casi muero.", "Nunca debí abrir esa puerta.")
- Última escena: cliffhanger o pregunta abierta SIEMPRE
- "fullNarration" = concatenación de todos los "text"`;

  let lastError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      logger.step(`Generando historia (intento ${intento}/3)...`);

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.92,
        max_tokens: 3000,
      });

      const rawContent = completion.choices[0]?.message?.content?.trim();
      if (!rawContent) throw new Error('Groq devolvió respuesta vacía');

      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const story = JSON.parse(cleaned);

      if (!story.title || !story.scenes || !Array.isArray(story.scenes)) {
        throw new Error('JSON con estructura inválida');
      }
      if (story.scenes.length < 4) {
        throw new Error(`Muy pocas escenas: ${story.scenes.length}`);
      }

      logger.ok(`Historia generada: "${story.title}" — ${story.scenes.length} escenas`);
      return story;

    } catch (error) {
      lastError = error;
      logger.warn(`Error intento ${intento}: ${error.message}`);
      if (intento < 3) {
        await sleep(intento * 2000);
      }
    }
  }

  throw new Error(`No se pudo generar la historia: ${lastError?.message}`);
}

export function getCategories() {
  return Object.entries(CATEGORIAS).map(([id, desc]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replace('_', ' '),
    description: desc,
    emoji: {
      terror: '👻', misterio: '🔍', motivacion: '💪', romance: '❤️',
      ciencia_ficcion: '🚀', historias_reales: '📖', leyendas: '🌙', suspenso: '😰',
    }[id] || '📺',
  }));
}
