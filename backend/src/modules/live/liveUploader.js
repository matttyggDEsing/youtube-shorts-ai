// ════════════════════════════════════════
// LIVE UPLOADER — YouTube Live API
// Crea, gestiona y cierra transmisiones en vivo en YouTube.
// Reutiliza las credenciales OAuth del youtubeUploader.js existente.
// ════════════════════════════════════════

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials', 'credentials.json');
const TOKEN_PATH       = path.join(process.cwd(), 'credentials', 'token.json');

// ── Auth ──────────────────────────────────────────────────────────────────────

function getOAuth2Client() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json no encontrado en: ${CREDENTIALS_PATH}`);
  }
  const { client_id, client_secret, redirect_uris } = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
  ).web ?? JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8')).installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('No hay token de YouTube. Autorizá la app desde /api/youtube/auth.');
  }
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
  return oAuth2Client;
}

function getYouTube() {
  return google.youtube({ version: 'v3', auth: getOAuth2Client() });
}

// ── Crear broadcast ───────────────────────────────────────────────────────────

/**
 * Crea un liveBroadcast en YouTube (todavía no está en vivo).
 *
 * @param {object} options
 * @param {string} options.title          - Título del directo
 * @param {string} options.description    - Descripción
 * @param {string} options.scheduledStart - ISO 8601 (ej: new Date().toISOString())
 * @param {string} options.privacyStatus  - 'public' | 'unlisted' | 'private'
 * @param {boolean} options.enableDvr
 * @param {boolean} options.recordFromStart
 * @returns {Promise<{ broadcastId: string, streamKey: string, rtmpUrl: string }>}
 */
export async function createLiveBroadcast({
  title,
  description,
  scheduledStart,
  privacyStatus   = 'public',
  enableDvr       = true,
  recordFromStart = true,
}) {
  const youtube = getYouTube();

  // 1. Crear broadcast
  const broadcastRes = await youtube.liveBroadcasts.insert({
    part: ['snippet', 'status', 'contentDetails'],
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: scheduledStart || new Date().toISOString(),
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableDvr,
        recordFromStart,
        enableAutoStart: true,
        enableAutoStop:  true,
      },
    },
  });

  const broadcastId = broadcastRes.data.id;
  logger.ok(`Broadcast creado: ${broadcastId}`);

  // 2. Crear stream
  const streamRes = await youtube.liveStreams.insert({
    part: ['snippet', 'cdn', 'status'],
    requestBody: {
      snippet: {
        title: `Stream para: ${title}`,
      },
      cdn: {
        frameRate:     '30fps',
        ingestionType: 'rtmp',
        resolution:    '1080p',
      },
    },
  });

  const streamId  = streamRes.data.id;
  const ingestion = streamRes.data.cdn.ingestionInfo;
  const rtmpUrl   = ingestion.ingestionAddress;
  const streamKey = ingestion.streamName;

  logger.ok(`Stream creado: ${streamId}`);

  // 3. Vincular broadcast ↔ stream
  await youtube.liveBroadcasts.bind({
    id:   broadcastId,
    part: ['id', 'contentDetails'],
    streamId,
  });

  logger.ok(`Broadcast ${broadcastId} vinculado a stream ${streamId}`);

  return { broadcastId, streamId, streamKey, rtmpUrl };
}

// ── Subir thumbnail ───────────────────────────────────────────────────────────

/**
 * Sube una miniatura personalizada al broadcast.
 * @param {string} broadcastId
 * @param {string} thumbnailPath - Path al archivo PNG/JPG
 */
export async function uploadLiveThumbnail(broadcastId, thumbnailPath) {
  if (!fs.existsSync(thumbnailPath)) {
    logger.warn(`Thumbnail no encontrado: ${thumbnailPath}`);
    return;
  }

  const youtube = getYouTube();

  await youtube.thumbnails.set({
    videoId: broadcastId,
    media: {
      mimeType: 'image/png',
      body:     fs.createReadStream(thumbnailPath),
    },
  });

  logger.ok(`Thumbnail subido al broadcast ${broadcastId}`);
}

// ── Actualizar tags del broadcast ─────────────────────────────────────────────

/**
 * Actualiza los tags y la descripción del broadcast vía videos.update.
 * (liveBroadcasts.update no acepta tags — se actualiza el video asociado)
 */
export async function updateBroadcastTags(broadcastId, tags) {
  const youtube = getYouTube();

  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: broadcastId,
      snippet: {
        tags,
        categoryId: '22', // People & Blogs (compatible con directos de contenido variado)
      },
    },
  });

  logger.ok(`Tags actualizados en broadcast ${broadcastId}`);
}

// ── Finalizar broadcast ───────────────────────────────────────────────────────

/**
 * Finaliza el directo (transición a estado "complete").
 * @param {string} broadcastId
 */
export async function endLiveBroadcast(broadcastId) {
  const youtube = getYouTube();

  await youtube.liveBroadcasts.transition({
    broadcastStatus: 'complete',
    id:   broadcastId,
    part: ['status'],
  });

  logger.ok(`Broadcast ${broadcastId} finalizado.`);
}

// ── Estado del broadcast ──────────────────────────────────────────────────────

/**
 * Devuelve el estado actual del broadcast.
 * @param {string} broadcastId
 * @returns {Promise<string>} - 'created' | 'ready' | 'testing' | 'live' | 'complete' | 'revoked'
 */
export async function getBroadcastStatus(broadcastId) {
  const youtube = getYouTube();

  const res = await youtube.liveBroadcasts.list({
    id:   broadcastId,
    part: ['status'],
  });

  return res.data.items?.[0]?.status?.lifeCycleStatus ?? 'unknown';
}

// ── Agregar comentario fijado ─────────────────────────────────────────────────

/**
 * Inserta un comentario fijado al inicio del directo.
 * @param {string} videoId
 * @param {string} text
 */
export async function pinComment(videoId, text) {
  const youtube = getYouTube();

  const res = await youtube.commentThreads.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        videoId,
        topLevelComment: {
          snippet: { textOriginal: text },
        },
      },
    },
  });

  logger.ok(`Comentario fijado en ${videoId}: "${text.substring(0, 50)}..."`);
  return res.data.id;
}

// ── Verificar si hay token válido ─────────────────────────────────────────────

export function hasValidToken() {
  return fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH);
}
