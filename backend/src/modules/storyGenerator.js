// ════════════════════════════════════════
// STORY GENERATOR — Generación de guiones con Groq / Llama 3.3
// v4: anti-repetición con historial + seed variable + forzado de unicidad
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { sleep, readHistory } from '../utils/fileManager.js';
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

// Ganchos de apertura variados por categoría
// Se elige uno al azar en cada generación para forzar diversidad
const HOOKS_POR_CATEGORIA = {
  terror: [
    'Nunca debí entrar ahí.',
    'Lo vi. No era humano.',
    'La puerta estaba abierta.',
    'Escuché mi nombre. Sola.',
    'El espejo no me reflejaba.',
    'Alguien respiraba en mi cuarto.',
    'Las fotos no eran mías.',
    'Desperté y no recordaba nada.',
    'La niña me señaló y sonrió.',
    'Había una figura en el techo.',
  ],
  misterio: [
    'Encontré algo que no debía.',
    'Me borraron la memoria.',
    'El sobre no tenía remitente.',
    'Desapareció sin dejar rastro.',
    'Nadie más lo vio.',
    'Las cámaras grabaron lo imposible.',
    'Me siguieron durante semanas.',
    'El número me llamó desde mi tumba.',
    'Todos mentían sobre esa noche.',
    'La verdad estaba escondida ahí.',
  ],
  motivacion: [
    'Lo perdí todo en un día.',
    'Me dijeron que nunca podría.',
    'Toqué fondo. Literalmente.',
    'Nadie apostaba por mí.',
    'Dormí en la calle tres meses.',
    'El rechazo me salvó la vida.',
    'Fallé veintisiete veces seguidas.',
    'Me quedé sin nada a los 30.',
    'Mi peor día fue mi punto de partida.',
    'Renuncié a todo para empezar de cero.',
  ],
  romance: [
    'Lo vi y supe que era él.',
    'Me enamoré de la persona equivocada.',
    'Un mensaje cambió todo.',
    'Nos conocimos por un error.',
    'Me dijo que no me amaba. Mentía.',
    'Lo busqué durante diez años.',
    'El destino nos separó dos veces.',
    'Era el amor de mi vida. Casado.',
    'Una canción me lo trajo de vuelta.',
    'Nos prometimos algo imposible.',
  ],
  ciencia_ficcion: [
    'La IA me dijo la verdad.',
    'Viajé al pasado por error.',
    'Me clonaron sin saberlo.',
    'El sistema me borró la identidad.',
    'Encontré mi propio cadáver.',
    'La simulación tenía un fallo.',
    'Me contactaron desde el futuro.',
    'La máquina predijo mi muerte.',
    'Descubrí que no soy real.',
    'El robot sabía demasiado.',
  ],
  historias_reales: [
    'Eso no debió pasarme a mí.',
    'Nadie me creyó al principio.',
    'Fue el día más extraño de mi vida.',
    'Lo que encontré me dejó sin palabras.',
    'Nunca olvidaré ese momento.',
    'Fue una coincidencia imposible.',
    'Me salvé de milagro.',
    'Lo que pasó después fue peor.',
    'Nadie sabe la verdad todavía.',
    'Cambió mi vida para siempre.',
  ],
  leyendas: [
    'Mi abuela me advirtió sobre eso.',
    'En mi pueblo nadie habla de eso.',
    'Lo vieron tres generaciones antes.',
    'La leyenda resultó ser real.',
    'Esa noche el río habló.',
    'El viejo del monte tenía razón.',
    'Nadie volvió del cerro solo.',
    'La llorona existe. La vi.',
    'Dicen que aparece cada cien años.',
    'Mi familia guarda ese secreto.',
  ],
  suspenso: [
    'Alguien sabía que estaría ahí.',
    'El mensaje llegó demasiado tarde.',
    'Vi algo que no debía ver.',
    'Me tendieron una trampa perfecta.',
    'Confiaba en la persona equivocada.',
    'El testigo desapareció esa noche.',
    'Tenía 24 horas para descubrirlo.',
    'Nadie salió de esa habitación.',
    'La llamada duró exactamente un minuto.',
    'Todo apuntaba a mí.',
  ],
};

// Keywords visuales por emoción
const EMOTION_VISUAL_HINTS = {
  fear:      'dark corridor, shadow moving wall, person hiding, door creaking, flashlight dark',
  tension:   'hands shaking close up, clock ticking, eye wide open, sweat drop face, running feet',
  sadness:   'rain window close up, person crying, empty street night, wilted flower, hands covering face',
  shock:     'person falling, broken glass, sudden light, face expression horror, crowd running',
  hope:      'sunrise horizon, hands reaching light, person standing cliff, door opening light',
  love:      'two hands touching, coffee table morning, smile close up, walking together, flowers',
  mystery:   'fog forest, old letter, shadow figure, empty room, candle flickering',
  suspense:  'footsteps hallway, looking over shoulder, phone ringing, car headlights night, window reflection',
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

  const minScenes = 8;
  const maxScenes = 14;
  const scenesCount = Math.min(maxScenes, Math.max(minScenes, Math.round(durationSeconds / 5)));

  // ── Leer historial para evitar repetir historias ──────────
  const recentTitles = readHistory()
    .filter(h => h.title && h.status !== 'failed')
    .slice(0, 20)                          // últimas 20 entradas
    .map(h => `"${h.title}"`)
    .join(', ');

  // ── Hook aleatorio para la primera escena ─────────────────
  const hooksDisponibles = HOOKS_POR_CATEGORIA[category] || HOOKS_POR_CATEGORIA.terror;
  const hookAleatorio    = hooksDisponibles[Math.floor(Math.random() * hooksDisponibles.length)];

  // ── Seed variable para forzar diversidad en Groq ──────────
  const promptSeed = `[seed:${Date.now()}]`;

  // Referencias visuales de la categoría para guiar a la IA
  const emotionHintsText = Object.entries(EMOTION_VISUAL_HINTS)
    .map(([emotion, examples]) => `  ${emotion}: "${examples}"`)
    .join('\n');

  const systemPrompt = `Eres un guionista experto en YouTube Shorts virales en español latinoamericano.
Creás historias adictivas con ritmo frenético, narración emocional en primera persona y ganchos narrativos.
Tu única tarea es responder con un JSON válido y nada más. Sin markdown, sin explicaciones, sin backticks.`;

  const userPrompt = `${promptSeed} Creá un guión para un YouTube Short VIRAL de categoría "${category}" (${descripcionCategoria}).

El video dura exactamente ${durationSeconds} segundos y tiene ${scenesCount} escenas.

${recentTitles ? `HISTORIAS YA GENERADAS — NO REPETIR NINGUNA DE ESTAS NI NADA SIMILAR:\n${recentTitles}\nLa nueva historia DEBE tener una trama, protagonista y situación completamente distinta a todas las anteriores.\n` : ''}
ESTILO OBLIGATORIO:
- Narración en PRIMERA PERSONA, voz íntima y emocional, como si le contaras un secreto al espectador
- Primera frase: gancho BRUTAL que genere curiosidad o impacto en menos de 5 palabras
- Ritmo frenético: frases cortas, potentes, que dejen al espectador sin aliento
- Cada escena termina con tensión que obliga a seguir escuchando
- La ÚLTIMA escena SIEMPRE termina en cliffhanger o pregunta que deje en suspenso
- Lenguaje coloquial latinoamericano, cercano, real

══════════════════════════════════════════
REGLAS PARA "videoKeywords" — MUY IMPORTANTE
══════════════════════════════════════════
Cada escena necesita 3 keywords en inglés para buscar B-roll en Pexels.
Los 3 keywords deben ir de más específico a más genérico, en este orden:

  keyword[0] = ESPECÍFICO: objeto o lugar concreto que aparece en la escena
               Ejemplo: si la escena es "entré a la casa abandonada de noche" → "abandoned house dark interior"
               Ejemplo: si la escena es "vi sangre en el piso" → "blood floor close up"
               Ejemplo: si la escena es "mi corazón latía fuerte" → "heartbeat chest close up"

  keyword[1] = ACCIÓN + EMOCIÓN: lo que hace el personaje + cómo se siente
               Ejemplo: "person running fear dark"
               Ejemplo: "woman crying window rain"
               Ejemplo: "man looking behind shoulder"

  keyword[2] = VISUAL ATMOSFÉRICO: ambiente general de la escena
               Usar estas referencias según la emoción de la escena:
${emotionHintsText}

REGLAS ADICIONALES para keywords:
- Siempre en inglés
- Máximo 4 palabras por keyword
- Que existan en Pexels (evitar keywords demasiado abstractos o específicos de trama)
- NO usar nombres propios, personajes famosos, logos ni marcas
- NO repetir el mismo keyword en más de 2 escenas

Devolvé ÚNICAMENTE este JSON (sin texto extra, sin markdown):
{
  "title": "Título impactante para YouTube (máx 60 caracteres, genera curiosidad)",
  "description": "Descripción para YouTube (máximo 150 palabras). Incluir call to action para suscribirse y ver la parte 2.",
  "tags": ["etiqueta1", "etiqueta2", "etiqueta3", "etiqueta4", "etiqueta5", "shorts", "historias"],
  "scenes": [
    {
      "text": "Texto narrado de esta escena. Máximo 20 palabras. Frase corta e impactante.",
      "videoKeywords": ["specific object/place", "action emotion", "atmospheric visual"],
      "duration": 4,
      "emotion": "tension|sadness|fear|hope|love|shock|mystery|suspense"
    }
  ],
  "fullNarration": "Texto completo de la narración, todo seguido sin separaciones"
}

REGLAS FINALES:
- "text" en español latinoamericano, máximo 20 palabras por escena
- Las duraciones sumadas deben dar ~${durationSeconds} segundos
- Primera escena: DEBE arrancar EXACTAMENTE con esta frase como gancho de apertura: "${hookAleatorio}" — no la modifiques, úsala tal cual como primer texto de la primera escena
- Última escena: cliffhanger o pregunta abierta SIEMPRE
- "fullNarration" = concatenación de todos los "text"`;

  // Temperatura variable por intento: sube si repite para forzar más creatividad
  const temperatures = [0.92, 1.05, 1.15];

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
        temperature: temperatures[intento - 1],
        max_tokens: 3500,
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

      // Verificar que el título no sea igual o muy similar a uno reciente
      const history = readHistory().filter(h => h.status !== 'failed').slice(0, 15);
      const normalizeTitle = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      const newTitleNorm   = normalizeTitle(story.title);
      const isDuplicate    = history.some(h => {
        if (!h.title) return false;
        const existingNorm = normalizeTitle(h.title);
        // Igual exacto, o más del 70% de palabras compartidas
        if (existingNorm === newTitleNorm) return true;
        const wordsNew = new Set(newTitleNorm.split(' ').filter(w => w.length > 3));
        const wordsOld = existingNorm.split(' ').filter(w => w.length > 3);
        if (!wordsNew.size) return false;
        const shared = wordsOld.filter(w => wordsNew.has(w)).length;
        return shared / wordsNew.size >= 0.7;
      });

      if (isDuplicate) {
        throw new Error(`Título demasiado similar a uno reciente: "${story.title}"`);
      }

      // Validar y normalizar videoKeywords — asegurar que siempre sea array de 3
      story.scenes = story.scenes.map((scene, i) => {
        let kw = scene.videoKeywords;
        if (!Array.isArray(kw)) kw = kw ? [kw] : [];
        // Si vino con menos de 3, rellenar con derivados del texto de la escena
        while (kw.length < 3) {
          const emotion = scene.emotion || 'tension';
          const fallback = EMOTION_VISUAL_HINTS[emotion]?.split(',')[kw.length]?.trim()
            || `cinematic ${emotion} scene`;
          kw.push(fallback);
        }
        return { ...scene, videoKeywords: kw.slice(0, 3) };
      });

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
