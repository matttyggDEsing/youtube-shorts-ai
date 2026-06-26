// ════════════════════════════════════════
// IMAGE GENERATOR — Generación de imágenes con Pollinations.ai
// ════════════════════════════════════════

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { sleep } from '../utils/fileManager.js';
import { logger } from '../utils/logger.js';

// URL base de Pollinations (completamente gratis, sin API key)
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';

// Sufijo visual para mejorar la calidad de todas las imágenes
const VISUAL_SUFFIX = ', cinematic, dramatic lighting, 9:16 vertical, high quality, photorealistic, detailed, professional photography';

/**
 * Descargar una imagen de Pollinations con reintentos
 * @param {string} prompt - Prompt en inglés para la imagen
 * @param {string} outputPath - Ruta donde guardar la imagen
 * @param {number} maxRetries - Número máximo de reintentos
 * @returns {Promise<string>} Ruta del archivo guardado
 */
async function downloadImage(prompt, outputPath, maxRetries = 3) {
  const fullPrompt = prompt + VISUAL_SUFFIX;
  const seed = Math.floor(Math.random() * 9999);

  const url = `${POLLINATIONS_BASE}/${encodeURIComponent(fullPrompt)}?width=720&height=1280&nologo=true&seed=${seed}`;

  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      logger.info(`Descargando imagen (intento ${intento}/${maxRetries}): ${prompt.substring(0, 60)}...`);

      const response = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 60000, // 60 segundos de timeout (Pollinations puede tardar)
        headers: {
          'User-Agent': 'YoutubeShorts-AI/1.0',
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Verificar que es una imagen válida (primeros bytes JPEG o PNG)
      const buffer = Buffer.from(response.data);
      const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
      const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50;

      if (!isJpeg && !isPng) {
        throw new Error('La respuesta no es una imagen válida');
      }

      fs.writeFileSync(outputPath, buffer);
      logger.ok(`Imagen guardada: ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return outputPath;

    } catch (error) {
      logger.warn(`Error en imagen intento ${intento}: ${error.message}`);

      if (intento < maxRetries) {
        // Backoff exponencial: 3s, 6s, 12s
        const backoff = 3000 * Math.pow(2, intento - 1);
        logger.info(`Esperando ${backoff / 1000}s antes de reintentar...`);
        await sleep(backoff);
      }
    }
  }

  // Si falló todo, crear imagen de placeholder negro
  logger.warn(`No se pudo descargar imagen para: "${prompt.substring(0, 40)}..." — usando placeholder`);
  return createPlaceholderImage(outputPath);
}

/**
 * Crear imagen placeholder negra cuando Pollinations falla
 */
function createPlaceholderImage(outputPath) {
  // JPEG negro mínimo 1x1 pixel
  const blackJpeg = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD2,
    0x8A, 0x28, 0x03, 0xFF, 0xD9,
  ]);
  fs.writeFileSync(outputPath, blackJpeg);
  return outputPath;
}

/**
 * Generar imágenes para todas las escenas del guión
 * @param {Array} scenes - Array de escenas con imagePrompt
 * @param {string} outputDir - Directorio donde guardar las imágenes
 * @returns {Promise<string[]>} Array de rutas de imágenes generadas
 */
export async function generateSceneImages(scenes, outputDir) {
  logger.step(`Generando ${scenes.length} imágenes para las escenas...`);

  // Crear directorio si no existe
  fs.mkdirSync(outputDir, { recursive: true });

  // Preparar promesas de descarga para todas las escenas
  const downloadPromises = scenes.map((scene, index) => {
    const filename = `scene_${String(index + 1).padStart(3, '0')}.jpg`;
    const outputPath = path.join(outputDir, filename);
    const prompt = scene.imagePrompt || `dark cinematic scene ${index + 1}`;
    return downloadImage(prompt, outputPath);
  });

  // Ejecutar en paralelo (Promise.allSettled para no fallar si una imagen falla)
  const results = await Promise.allSettled(downloadPromises);

  const imagePaths = [];
  let exitosas = 0;
  let fallidas = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      imagePaths.push(result.value);
      exitosas++;
    } else {
      // Usar placeholder si la descarga falló completamente
      const filename = `scene_${String(i + 1).padStart(3, '0')}.jpg`;
      const fallbackPath = path.join(outputDir, filename);
      imagePaths.push(createPlaceholderImage(fallbackPath));
      fallidas++;
      logger.warn(`Escena ${i + 1}: usando imagen placeholder`);
    }
  }

  logger.ok(`Imágenes generadas: ${exitosas} exitosas, ${fallidas} placeholders`);
  return imagePaths;
}
