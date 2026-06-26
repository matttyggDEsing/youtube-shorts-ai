// ════════════════════════════════════════
// SSE MANAGER — Server-Sent Events para progreso en tiempo real
// ════════════════════════════════════════

// Mapa de clientes SSE activos: { clientId → res }
const clients = new Map();

/**
 * Registrar un cliente SSE nuevo
 */
export function addClient(clientId, res) {
  // Cabeceras para SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Enviar evento de conexión establecida
  res.write(`data: ${JSON.stringify({ step: 'connected', progress: 0, message: 'Conexión establecida' })}\n\n`);

  // Heartbeat cada 20s para evitar que el browser corte la conexión SSE
  // durante procesos largos (generación de imágenes, ffmpeg, etc.)
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping\n\n`);
    }
  }, 20000);

  clients.set(clientId, res);

  // Limpiar al desconectar el cliente
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });
}

/**
 * Enviar evento de progreso a un cliente específico
 */
export function sendProgress(clientId, data) {
  const res = clients.get(clientId);
  if (res) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Finalizar stream SSE de un cliente
 */
export function closeClient(clientId) {
  const res = clients.get(clientId);
  if (res) {
    res.end();
    clients.delete(clientId);
  }
}

/**
 * Verificar si un cliente sigue conectado
 */
export function clientExists(clientId) {
  return clients.has(clientId);
}
