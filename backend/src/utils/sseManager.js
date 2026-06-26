// ════════════════════════════════════════
// SSE MANAGER — Server-Sent Events para progreso en tiempo real
// Fix #9: límite de clientes SSE concurrentes + timeout de limpieza por inactividad
// ════════════════════════════════════════

// Mapa de clientes SSE activos: { clientId → { res, timer } }
const clients = new Map();

// Máximo de clientes SSE simultáneos permitidos
const MAX_CLIENTS = 20;

// Tiempo máximo sin actividad antes de cerrar la conexión (10 minutos)
// Cubre el caso en que el cliente se desconecta sin disparar el evento 'close'
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Registrar un cliente SSE nuevo
 */
export function addClient(clientId, res) {
  // FIX #9: rechazar si se superó el límite de clientes concurrentes
  if (clients.size >= MAX_CLIENTS) {
    res.status(503).json({ error: 'Demasiadas conexiones SSE activas. Intentá de nuevo en unos segundos.' });
    return;
  }

  // Cabeceras para SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Evento de conexión establecida
  res.write(`data: ${JSON.stringify({ step: 'connected', progress: 0, message: 'Conexión establecida' })}\n\n`);

  // Heartbeat cada 20s para evitar que el browser corte la conexión
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping\n\n`);
    }
  }, 20000);

  // FIX #9: timeout de seguridad — cierra la conexión si lleva más de
  // IDLE_TIMEOUT_MS sin que el pipeline la cierre explícitamente.
  // Esto evita que clientes "fantasma" (navegador cerrado sin evento 'close')
  // acumulen entradas en el Map indefinidamente.
  const idleTimer = setTimeout(() => {
    if (clients.has(clientId)) {
      closeClient(clientId);
    }
  }, IDLE_TIMEOUT_MS);

  clients.set(clientId, { res, heartbeat, idleTimer });

  // Limpiar al desconectar el cliente normalmente
  res.on('close', () => {
    _cleanup(clientId);
  });
}

/**
 * Limpiar recursos internos de un cliente (sin cerrar la respuesta)
 */
function _cleanup(clientId) {
  const entry = clients.get(clientId);
  if (entry) {
    clearInterval(entry.heartbeat);
    clearTimeout(entry.idleTimer);
    clients.delete(clientId);
  }
}

/**
 * Enviar evento de progreso a un cliente específico
 */
export function sendProgress(clientId, data) {
  const entry = clients.get(clientId);
  if (entry && !entry.res.writableEnded) {
    entry.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Finalizar stream SSE de un cliente
 */
export function closeClient(clientId) {
  const entry = clients.get(clientId);
  if (entry) {
    if (!entry.res.writableEnded) {
      entry.res.end();
    }
    _cleanup(clientId);
  }
}

/**
 * Verificar si un cliente sigue conectado
 */
export function clientExists(clientId) {
  return clients.has(clientId);
}

/**
 * Cantidad de clientes SSE activos (útil para monitoreo)
 */
export function activeClientCount() {
  return clients.size;
}
