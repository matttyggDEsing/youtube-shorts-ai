// ════════════════════════════════════════
// LIVE DESCRIPTION GENERATOR
// Genera descripciones SEO optimizadas
// para directos de YouTube con Groq / Llama 3.3
// ════════════════════════════════════════

import Groq from 'groq-sdk';
import { logger } from '../../utils/logger.js';

// ── Bloques estáticos por categoría ──────────────────────────
const CATEGORY_BLOCKS = {
  terror_misterio: {
    intro: 'Bienvenido al directo de historias de terror y misterio más escalofriante en español. Cada noche narramos las historias más aterradoras de Latinoamérica: leyendas urbanas, casos sin resolver, suspenso psicológico y mucho más.',
    contenido: [
      '👻 Historias de terror narradas en español',
      '🔍 Misterios y casos sin resolver',
      '🌑 Leyendas urbanas de Latinoamérica',
      '🎭 Suspenso y thrillers psicológicos',
      '📖 Historias reales inexplicables',
    ],
    cta: 'Si te gustan las historias que te erizan la piel, este es tu lugar. Suscribite y activá la campanita para no perderte ningún directo.',
  },
  musica_estudiar: {
    intro: 'El mejor espacio para estudiar, trabajar y concentrarte en español. Música ambiental cuidadosamente seleccionada para maximizar tu productividad y mantener el foco durante horas.',
    contenido: [
      '🎵 Música lofi y ambiental sin letra',
      '📚 Ideal para estudiar y hacer tareas',
      '💻 Perfecta para trabajar desde casa',
      '🧠 Aumenta la concentración y el foco',
      '⏱ Sin interrupciones ni anuncios entre tracks',
    ],
    cta: 'Ponelo de fondo y arrancá a estudiar. Suscribite para encontrarnos siempre que lo necesités.',
  },
  musica_dormir: {
    intro: 'El ambiente sonoro perfecto para relajarte y conciliar el sueño. Música suave y sonidos relajantes seleccionados para acompañarte durante toda la noche.',
    contenido: [
      '😴 Música suave para dormir profundamente',
      '🌙 Sonidos relajantes para la noche',
      '🧘 Ideal para meditación y mindfulness',
      '💤 Reduce el estrés y la ansiedad',
      '🌊 Sonidos de naturaleza mezclados',
    ],
    cta: 'Ponelo antes de dormir y dejá que la música haga el resto. Suscribite para tener siempre tu espacio de descanso.',
  },
  motivacion: {
    intro: 'Tu dosis diaria de motivación en español. Frases poderosas, historias de superación y mentalidad ganadora para emprendedores, estudiantes y personas que quieren más de la vida.',
    contenido: [
      '💪 Frases motivacionales que cambian vidas',
      '🌟 Historias de superación personal',
      '🧠 Mentalidad ganadora y disciplina',
      '🚀 Para emprendedores y soñadores',
      '📈 Contenido de crecimiento personal',
    ],
    cta: 'Si querés crecer cada día, este directo es para vos. Suscribite y empezá tu día con la mentalidad correcta.',
  },
  lofi: {
    intro: 'Tu cafetería virtual en español. Beats lofi, lluvia de fondo y el ambiente perfecto para acompañarte mientras estudiás, trabajás o simplemente te relajás.',
    contenido: [
      '☕ Ambiente de cafetería con lofi',
      '🎵 Beats relajantes sin letra',
      '🌧️ Lluvia de fondo opcional',
      '📚 Perfecto para estudiar y trabajar',
      '🎧 Selección curada de lofi en español',
    ],
    cta: 'Tu espacio de concentración favorito está siempre abierto. Suscribite para encontrarnos cuando lo necesités.',
  },
  lluvia: {
    intro: 'El sonido más relajante del planeta, disponible las 24 horas. Lluvia suave, tormenta nocturna y sonidos del agua para dormir, concentrarte o simplemente desconectarte del mundo.',
    contenido: [
      '🌧️ Lluvia suave y continua',
      '⛈️ Tormenta nocturna relajante',
      '☕ Lluvia en cafetería',
      '🌲 Lluvia en bosque',
      '😴 Ideal para dormir y meditar',
    ],
    cta: 'El sonido de la lluvia siempre está acá. Suscribite y tené tu espacio de paz a un click.',
  },
  naturaleza: {
    intro: 'Escapate del ruido del mundo con los sonidos más puros de la naturaleza. Olas del mar, bosques, pájaros y brisa para meditar, relajarte o simplemente respirar.',
    contenido: [
      '🌊 Olas del mar y océano',
      '🌲 Bosques y naturaleza',
      '🐦 Pájaros y brisa suave',
      '🌿 Sonidos de selva tropical',
      '🧘 Perfecto para meditación y yoga',
    ],
    cta: 'La naturaleza siempre está acá para vos. Suscribite y encontrá tu calma cuando la necesités.',
  },
  curiosidades: {
    intro: 'El lugar donde la realidad supera a la ficción. Datos curiosos, hechos increíbles y misterios del mundo que nadie te contó, narrados en español de manera entretenida.',
    contenido: [
      '🤯 Datos curiosos increíbles',
      '🌍 Misterios del mundo',
      '🧪 Ciencia y naturaleza sorprendente',
      '📚 Historia y cultura fascinante',
      '🔭 Espacio y astronomía',
    ],
    cta: 'Cada curiosidad que escuchés te va a dejar con ganas de más. Suscribite para no perderte ningún dato.',
  },
};

// ── Timestamps de ejemplo por duración ───────────────────────
function generateTimestamps(durationHours, category) {
  const sections = Math.min(durationHours, 6);
  const labels = {
    terror_misterio: ['Historias de Terror', 'Leyendas Urbanas', 'Casos sin Resolver', 'Misterios', 'Suspenso Extremo', 'Historias Reales'],
    musica_estudiar: ['Lofi Session', 'Piano Ambiental', 'Jazz Suave', 'Deep Focus', 'Chillhop', 'Instrumental'],
    musica_dormir:   ['Relajación Inicial', 'Lluvia Suave', 'Piano Nocturno', 'Naturaleza', 'Deep Sleep', 'Amanecer'],
    motivacion:      ['Mentalidad', 'Superación', 'Disciplina', 'Éxito', 'Frases Poderosas', 'Cierre Motivacional'],
    lofi:            ['Morning Lofi', 'Study Session', 'Chill Beats', 'Coffee Time', 'Evening Lofi', 'Night Session'],
    lluvia:          ['Lluvia Suave', 'Tormenta', 'Lluvia en Bosque', 'Lluvia Nocturna', 'Tormenta Fuerte', 'Lluvia al Amanecer'],
    naturaleza:      ['Océano', 'Bosque', 'Pájaros', 'Río', 'Brisa', 'Amanecer Natural'],
    curiosidades:    ['Ciencia', 'Historia', 'Naturaleza', 'Espacio', 'Cultura', 'Misterios'],
  };

  const sectionLabels = labels[category] || labels.musica_estudiar;
  const timestamps = ['00:00 - Inicio del Directo'];

  for (let i = 1; i < sections; i++) {
    const horas   = Math.floor((i * durationHours) / sections);
    const minutos = Math.round(((i * durationHours) / sections - horas) * 60);
    const tiempo  = `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:00`;
    timestamps.push(`${tiempo} - ${sectionLabels[i] || `Sección ${i + 1}`}`);
  }

  return timestamps.join('\n');
}

// ── Función principal ─────────────────────────────────────────
/**
 * Genera una descripción SEO completa para un directo de YouTube.
 * @param {string} category       — Categoría del directo
 * @param {string} title          — Título del directo
 * @param {string[]} keywords     — Palabras clave adicionales
 * @param {number} durationHours  — Duración en horas
 * @returns {Promise<string>}     — Descripción lista para YouTube
 */
export async function generateLiveDescription(category, title, keywords = [], durationHours = 8) {
  logger.step(`Generando descripción para: "${title}"`);

  const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const block = CATEGORY_BLOCKS[category] || CATEGORY_BLOCKS.musica_estudiar;

  const prompt = `Escribí el párrafo de bienvenida para un directo de YouTube de ${durationHours} horas titulado: "${title}"
Categoría: ${category}
Palabras clave a incluir naturalmente: ${keywords.join(', ')}

REGLAS:
- Exactamente 3 oraciones
- Primera oración: bienvenida cálida y directa
- Segunda oración: qué va a encontrar el espectador (usar las palabras clave)
- Tercera oración: por qué este directo es diferente o especial
- Español latinoamericano, tono cercano
- Sin markdown, sin comillas, texto plano

Respondé SOLO con el párrafo, nada más.`;

  let introParagraph = block.intro;

  try {
    const completion = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  200,
      temperature: 0.75,
    });

    const raw = completion.choices[0].message.content.trim();
    if (raw.length > 50) introParagraph = raw;

  } catch (error) {
    logger.warn(`Error en Groq para descripción: ${error.message}. Usando fallback.`);
  }

  // ── Ensamblar descripción completa ───────────────────────────
  const contenidoList = block.contenido.map(item => `  ${item}`).join('\n');
  const timestamps    = generateTimestamps(durationHours, category);

  const descripcion = `${introParagraph}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 ¿QUÉ VAS A ENCONTRAR ACÁ?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contenidoList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱ CONTENIDO DEL DIRECTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${timestamps}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔 NO TE PIERDAS NADA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${block.cta}

👍 Si el directo te está ayudando, dejá un LIKE — le dice al algoritmo que lo muestre a más gente.
💬 Contanos en el chat desde dónde nos ves.
🔔 Suscribite y activá la campanita para recibir avisos de cada directo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 PALABRAS CLAVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${keywords.join(' • ')}`;

  logger.ok(`Descripción generada: ${descripcion.length} caracteres`);
  return descripcion;
}
