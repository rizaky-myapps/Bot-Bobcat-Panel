const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const debugEnabled = Boolean(process.env.DEBUG);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function format(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function write(level, scope, args) {
  if (level === 'debug' && !debugEnabled) return;
  const label = level.toUpperCase().padEnd(7);
  const text = args.map(format).join(' ');
  const line = useColor
    ? `${DIM}[${timestamp()}]${RESET} ${COLORS[level]}${label}${RESET} ${DIM}[${scope}]${RESET} ${text}`
    : `[${timestamp()}] ${label} [${scope}] ${text}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(scope) {
  return {
    debug: (...args) => write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    success: (...args) => write('success', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args),
  };
}
