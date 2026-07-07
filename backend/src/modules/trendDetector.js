// ════════════════════════════════════════
// TREND DETECTOR — Detecta nichos en tendencia,
// extrae keywords y hashtags reales de YouTube
// ════════════════════════════════════════

import googleTrends from 'google-trends-api';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './youtubeUploader.js';
import { logger } from '../utils/logger.js';

// Mapeo de nichos conocidos a queries de búsqueda representativas
// (esto conecta la tendencia detectada con tus categorías existentes o nuevas)
const NICHOS_REFERENCIA = {
  terror:            'historias de terror reales shorts',
  misterio:           'casos sin resolver misterio shorts',
  true_crime:         'true crime historias reales shorts',
  drama_traicion:     'historias de traicion venganza shorts',
  finanzas:           'finanzas personales inversion shorts',
  ia_automatizacion:  'inteligencia artificial tutorial shorts',
  motivacion:         'motivacion superacion personal shorts',
  salud_mental:       'ansiedad mindfulness salud mental shorts',
};

/**
 * 1. Detecta nichos en tendencia ahora mismo.
 * Estrategia en cascada (cada capa es más confiable que la anterior):
 *   a) Google Trends (rápido pero frágil — Google le cambia el endpoint seguido
 *      y a veces devuelve HTML en vez de JSON)
 *   b) YouTube "más populares" (API oficial, estable, con datos reales de shorts
 *      que están funcionando en YouTube ahora mismo)
 *   c) Nichos evergreen fijos (siempre disponibles, garantiza que el flujo no se rompa)
 */
export async function getNichosEnTendencia(region = 'AR') {
  let tendenciasActuales = await getTendenciasGoogle(region);

  if (tendenciasActuales.length === 0) {
    logger.warn('Google Trends sin resultados, uso YouTube "más populares" como fuente de tendencias');
    tendenciasActuales = await getTendenciasYoutube(region);
  }

  const nichosBase = Object.entries(NICHOS_REFERENCIA).map(([id, query]) => ({
    id,
    query,
    fuente: 'referencia_evergreen',
  }));

  return { tendenciasActuales, nichosBase };
}

async function getTendenciasGoogle(region) {
  try {
    const raw = await googleTrends.dailyTrends({ geo: region });

    // El endpoint no oficial a veces devuelve HTML (página de consentimiento
    // o error de Google) en vez de JSON. Detectarlo ANTES de intentar parsear
    // evita el error "Unexpected token '<'" y permite pasar al fallback limpio.
    if (typeof raw !== 'string' || raw.trim().startsWith('<')) {
      throw new Error('Google Trends devolvió HTML en vez de JSON (endpoint bloqueado o caído)');
    }

    const data = JSON.parse(raw);
    const trendingSearches = data.default.trendingSearchesDays[0]?.trendingSearches || [];

    return trendingSearches.slice(0, 15).map(t => ({
      termino: t.title.query,
      trafico: t.formattedTraffic,
      relacionados: t.relatedQueries?.map(r => r.query) || [],
      fuente: 'google_trends',
    }));
  } catch (error) {
    logger.warn(`Google Trends falló (${error.message})`);
    return [];
  }
}

/**
 * Fallback oficial y estable: usa el chart "más populares" de YouTube
 * para categorías afines a contenido narrado/shorts (People & Blogs,
 * Entertainment) y arma "nichos en tendencia" a partir de tags reales.
 */
async function getTendenciasYoutube(region) {
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  // 22 = People & Blogs, 24 = Entertainment — las más relevantes para shorts narrados
  const categoriasRelevantes = ['22', '24'];
  const resultados = [];

  for (const categoryId of categoriasRelevantes) {
    try {
      const res = await youtube.videos.list({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: region,
        videoCategoryId: categoryId,
        maxResults: 10,
      });

      for (const video of res.data.items || []) {
        const tagsPrincipales = (video.snippet.tags || []).slice(0, 3);
        if (tagsPrincipales.length === 0) continue;

        resultados.push({
          termino: tagsPrincipales.join(', '),
          trafico: `${Number(video.statistics.viewCount || 0).toLocaleString('es-AR')} vistas`,
          relacionados: [video.snippet.title],
          fuente: 'youtube_trending',
        });
      }
    } catch (error) {
      logger.warn(`YouTube "más populares" falló para categoría ${categoryId}: ${error.message}`);
    }
  }

  return resultados.slice(0, 15);
}

/**
 * 2. Dado un nicho/query elegido por el usuario, busca los videos
 * mejor posicionados en YouTube y extrae keywords + hashtags reales
 */
export async function analizarNicho(query, opciones = {}) {
  const { maxResultados = 15, region = 'AR' } = opciones;
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  // 2a. Buscar videos top del nicho (Shorts, ordenados por relevancia/vistas)
  const searchRes = await youtube.search.list({
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    order: 'viewCount',
    regionCode: region,
    relevanceLanguage: 'es',
    maxResults: maxResultados,
  });

  const videoIds = searchRes.data.items.map(item => item.id.videoId).filter(Boolean);
  if (videoIds.length === 0) {
    throw new Error(`No se encontraron videos para el nicho: "${query}"`);
  }

  // 2b. Traer detalles completos (tags, estadísticas) de esos videos
  const detailsRes = await youtube.videos.list({
    part: 'snippet,statistics',
    id: videoIds.join(','),
  });

  const keywordCount = {};
  const hashtagCount = {};
  const titulosReferencia = [];

  for (const video of detailsRes.data.items) {
    const { title, description, tags = [] } = video.snippet;
    titulosReferencia.push(title);

    // Contar tags/keywords oficiales del video
    for (const tag of tags) {
      const clean = tag.toLowerCase().trim();
      keywordCount[clean] = (keywordCount[clean] || 0) + 1;
    }

    // Extraer hashtags reales del título + descripción
    const textoCompleto = `${title} ${description}`;
    const hashtagsEncontrados = textoCompleto.match(/#[\wáéíóúñÁÉÍÓÚÑ]+/g) || [];
    for (const tag of hashtagsEncontrados) {
      const clean = tag.toLowerCase();
      hashtagCount[clean] = (hashtagCount[clean] || 0) + 1;
    }
  }

  // Ordenar por frecuencia de aparición (lo más usado = lo más relevante)
  const keywordsTop = Object.entries(keywordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([kw, count]) => ({ keyword: kw, apariciones: count }));

  const hashtagsTop = Object.entries(hashtagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ hashtag: tag, apariciones: count }));

  return {
    query,
    videosAnalizados: videoIds.length,
    keywords: keywordsTop,
    hashtags: hashtagsTop,
    titulosReferencia: titulosReferencia.slice(0, 10),
  };
}
