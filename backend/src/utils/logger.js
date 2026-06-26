// ════════════════════════════════════════
// LOGGER — Registro con timestamps en español
// ════════════════════════════════════════

const niveles = {
  INFO:  '\x1b[36m[INFO]\x1b[0m',
  OK:    '\x1b[32m[OK]\x1b[0m',
  WARN:  '\x1b[33m[AVISO]\x1b[0m',
  ERROR: '\x1b[31m[ERROR]\x1b[0m',
  STEP:  '\x1b[35m[PASO]\x1b[0m',
};

function timestamp() {
  return new Date().toLocaleString('es-AR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function log(nivel, mensaje, extra = '') {
  const prefix = niveles[nivel] || niveles.INFO;
  const ts = `\x1b[90m${timestamp()}\x1b[0m`;
  console.log(`${ts} ${prefix} ${mensaje}`, extra || '');
}

export const logger = {
  info:  (msg, extra) => log('INFO',  msg, extra),
  ok:    (msg, extra) => log('OK',    msg, extra),
  warn:  (msg, extra) => log('WARN',  msg, extra),
  error: (msg, extra) => log('ERROR', msg, extra),
  step:  (msg, extra) => log('STEP',  msg, extra),
};
