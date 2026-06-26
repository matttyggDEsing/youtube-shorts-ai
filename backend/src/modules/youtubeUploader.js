// ════════════════════════════════════════
// YOUTUBE UPLOADER — Subida con googleapis y OAuth 2.0
// ════════════════════════════════════════

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const CREDENTIALS_PATH = './credentials/credentials.json';
const TOKEN_PATH        = './credentials/token.json';
const SCOPES            = ['https://www.googleapis.com/auth/youtube.upload'];

/**
 * Crear cliente OAuth2 desde credentials.json
 */
function createOAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'No se encontró credentials.json en ./credentials/. ' +
      'Descargalo desde Google Cloud Console → APIs → YouTube Data API v3 → Credenciales.'
    );
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

/**
 * Verificar si existe un token válido
 * @returns {boolean}
 */
export function hasValidToken() {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return false;
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    return !!token.access_token || !!token.refresh_token;
  } catch {
    return false;
  }
}

/**
 * Obtener URL de autorización OAuth para mostrar al usuario
 * @returns {string} URL de autorización
 */
export function getAuthUrl() {
  const oAuth2Client = createOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

/**
 * Intercambiar código de autorización por token y guardarlo
 * @param {string} code - Código recibido del callback OAuth
 */
export async function saveTokenFromCode(code) {
  const oAuth2Client = createOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  logger.ok('Token de YouTube guardado exitosamente.');
  return tokens;
}

/**
 * Obtener cliente OAuth2 autenticado
 * Carga y refresca el token automáticamente
 */
async function getAuthenticatedClient() {
  const oAuth2Client = createOAuthClient();

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('No hay token de YouTube. Autoriza la app primero en /api/youtube/auth');
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);

  // Refrescar token si está por vencer
  oAuth2Client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) {
      const updated = { ...token, ...newTokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      logger.info('Token de YouTube refrescado automáticamente.');
    }
  });

  return oAuth2Client;
}

/**
 * Subir video a YouTube como Short
 * @param {string} videoPath - Ruta al archivo MP4
 * @param {Object} options - Metadatos del video
 * @returns {Promise<{videoId: string, url: string}>}
 */
export async function uploadToYoutube(videoPath, { title, description, tags, categoryId = '24' }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`No se encontró el video en: ${videoPath}`);
  }

  logger.step(`Subiendo video a YouTube: "${title}"`);

  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const fileSize = fs.statSync(videoPath).size;
  logger.info(`Tamaño del video: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  // ── Forzar clasificación como Short ──────────────────────────
  // YouTube requiere #Shorts en título o descripción para clasificarlo correctamente
  const shortsTitle = title.endsWith('#Shorts')
    ? title.substring(0, 100)
    : `${title} #Shorts`.substring(0, 100);

  const shortsDescription = description
    ? (description.includes('#Shorts') ? description : `${description}\n\n#Shorts`)
    : '#Shorts';

  const shortsTags = [...new Set([...(tags || []), 'shorts', 'Shorts', 'YouTubeShorts'])];

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title:                shortsTitle,
        description:          shortsDescription,
        tags:                 shortsTags,
        categoryId:           categoryId, // 24 = Entertainment
        defaultLanguage:      'es',
        defaultAudioLanguage: 'es',
      },
      status: {
        privacyStatus:              'public',
        selfDeclaredMadeForKids:    false,
        madeForKids:                false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = response.data.id;
  const url = `https://youtu.be/${videoId}`;

  logger.ok(`Short subido exitosamente: ${url}`);

  return { videoId, url };
}

/**
 * Verificar el estado de la conexión con YouTube
 * @returns {Object} Estado de la conexión
 */
export async function checkYoutubeStatus() {
  const credentialsExist = fs.existsSync(CREDENTIALS_PATH);
  const tokenExists = hasValidToken();

  if (!credentialsExist) {
    return { connected: false, reason: 'Sin credentials.json' };
  }

  if (!tokenExists) {
    return { connected: false, reason: 'Sin token de autorización' };
  }

  try {
    const auth = await getAuthenticatedClient();
    const youtube = google.youtube({ version: 'v3', auth });

    await youtube.channels.list({ part: ['snippet'], mine: true });

    return { connected: true };
  } catch (error) {
    return { connected: false, reason: error.message };
  }
}
