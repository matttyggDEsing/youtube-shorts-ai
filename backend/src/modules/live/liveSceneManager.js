// ════════════════════════════════════════
// LIVE SCENE MANAGER
// Genera y gestiona el contenido narrativo del directo:
// - Historias/frases en bucle para la categoría
// - Narración TTS de cada bloque
// - Cola de contenido para que nunca haya silencio
// ════════════════════════════════════════

import path from 'path';
import fs from 'fs';
import Groq from 'groq-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { logger } from '../../utils/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Duración aproximada de cada bloque de contenido (segundos)
const BLOCK_DURATION = {
  terror_misterio: 90,   // historia corta ~90s
  musica_estudiar: 0,    // sin narración, solo música
  motivacion:      30,   // frase motivacional ~30s
  musica_dormir:   0,    // sin narración
  lofi:            0,    // sin narración
};

// Prompts por categoría
const CONTENT_PROMPTS = {
  terror_misterio: (n) => `Escribe una historia de terror o misterio muy corta para narrar en un directo de YouTube.
La historia debe:
- Durar entre 60 y 90 segundos cuando se lee en voz alta (aprox 130-170 palabras)
- Tener gancho desde la primera oración
- Atmósfera oscura, inquietante o paranormal
- Final abierto o perturbador que invite a quedarse
- Escrita en primera persona o segunda persona
- Historia número ${n} (diferente a las anteriores)
Solo devuelve la narración, sin título, sin comentarios.`,

  motivacion: (n) => `Escribe una frase o reflexión motivacional poderosa para narrar en un directo de YouTube.
Debe:
- Durar entre 20 y 35 segundos cuando se lee en voz alta (aprox 50-80 palabras)
- Empezar con una pregunta o afirmación impactante
- Mensaje de superación, mentalidad, éxito o disciplina
- Lenguaje directo, inspirador, en español
- Reflexión número ${n} (diferente a las anteriores)
Solo devuelve el texto a narrar, sin título, sin comentarios.`,
};

/**
 * Genera un bloque de audio narrado para el contenido del directo.
 * Categorías de solo música devuelven null (no necesitan narración).
 *
 * @param {string} category   - Categoría del directo
 * @param {number} blockIndex - Número de bloque (para variedad)
 * @param {string} voice      - Voz TTS (ej: 'es-MX-DaliaNeural')
 * @param {string} outputDir  - Directorio donde guardar el MP3
 * @returns {Promise<{ audioPath: string, text: string } | null>}
 */
export async function generateContentBlock(category, blockIndex, voice, outputDir) {
  const promptFn = CONTENT_PROMPTS[category];

  // Categorías de solo música: no hay narración
  if (!promptFn) {
    return null;
  }

  try {
    // 1. Generar texto con Groq
    logger.step(`SceneManager: generando bloque ${blockIndex} de "${category}"...`);
    const text = await generateText(promptFn(blockIndex));

    // 2. Convertir a audio con TTS
    fs.mkdirSync(outputDir, { recursive: true });
    const audioPath = path.join(outputDir, `block_${String(blockIndex).padStart(4, '0')}.mp3`);
    await synthesizeSpeech(text, voice, audioPath);

    logger.ok(`SceneManager: bloque ${blockIndex} listo → ${audioPath}`);
    return { audioPath, text };

  } catch (error) {
    logger.error(`SceneManager: error en bloque ${blockIndex}: ${error.message}`);
    return null;
  }
}

/**
 * Rellena la cola de contenido anticipadamente.
 * Genera N bloques en paralelo y los encola.
 * Llamar periódicamente para mantener el buffer lleno.
 *
 * @param {object} options
 * @param {string}   options.category
 * @param {string}   options.voice
 * @param {string}   options.outputDir
 * @param {number}   options.startIndex   - Desde qué número de bloque empezar
 * @param {number}   options.count        - Cuántos bloques generar
 * @returns {Promise<Array<{ audioPath: string, text: string }>>}
 */
export async function prefetchContentBlocks({ category, voice, outputDir, startIndex = 0, count = 5 }) {
  const tasks = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    tasks.push(generateContentBlock(category, i, voice, outputDir));
  }

  const results = await Promise.allSettled(tasks);
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

/**
 * Devuelve la duración aproximada en segundos de cada bloque según categoría.
 */
export function getBlockDuration(category) {
  return BLOCK_DURATION[category] ?? 60;
}

/**
 * Indica si una categoría necesita narración TTS en el directo.
 */
export function categoryNeedsNarration(category) {
  return !!CONTENT_PROMPTS[category];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateText(prompt) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
    max_tokens: 400,
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Groq devolvió respuesta vacía');
  return text;
}

async function synthesizeSpeech(text, voice, outputPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  // msedge-tts puede devolver path o un objeto con .audioFilePath
  const result = await tts.toFile(path.dirname(outputPath), text);

  // Normalizar resultado a string de path
  const generatedPath = typeof result === 'string'
    ? result
    : result?.audioFilePath ?? result?.path ?? null;

  if (!generatedPath) throw new Error('TTS no devolvió path de audio');

  // Renombrar al path definitivo si es diferente
  if (generatedPath !== outputPath) {
    fs.renameSync(generatedPath, outputPath);
  }
}
