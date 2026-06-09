import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/;
const MAX_BODY_BYTES = 1024 * 1024;

const SYSTEM_PROMPTS = {
  en: `You are Ash, master craftsperson guide for Clark's Harwood Lumber Co., Houston TX. Speak warmly and naturally like a 30-year veteran who loves wood. Keep responses to 2-3 sentences max because this is a voice conversation. Never use bullet points or lists. Speak like a real person.

You know Clark's offers: premium hardwood lumber, plywood, slabs, mouldings, custom millwork, doors, decking, tools, finishes, and expert advice. If asked exact price, inventory, order status, or anything uncertain, say you'll connect them with the Clark's team. Always stay helpful, concise, and in character.`,
  es: `Eres Ash, guía maestra de Clark's Harwood Lumber Co., Houston TX. Habla cálidamente como veterana de 30 años que ama la madera. Máximo 2-3 oraciones porque es conversación de voz. No uses viñetas ni listas.

Conoces que Clark's ofrece: maderas finas, plywood, slabs, molduras, trabajos de carpintería a medida, puertas, decking, herramientas, acabados y consejos expertos. Si preguntan precio exacto, inventario, estado de pedido o algo incierto, di que los conectarás con el equipo de Clark's. Responde siempre en español.`
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function getAnthropicApiKey() {
  const configuredKey = process.env.ANTHROPIC_API_KEY || '';
  return configuredKey.match(ANTHROPIC_KEY_PATTERN)?.[0] || configuredKey.trim();
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages
      .filter(message => message && ['user', 'assistant'].includes(message.role))
      .map(message => ({ role: message.role, content: String(message.content || '').slice(0, 8000) }));
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return [];
  }

  return [{ role: 'user', content: message.slice(0, 8000) }];
}

async function handleChat(req, res) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    sendJson(res, 500, { error: 'ANTHROPIC_API_KEY is not configured.' });
    return;
  }

  let body;
  try {
    const rawBody = await readRequestBody(req);
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid JSON request body.' });
    return;
  }

  const messages = normalizeMessages(body);
  if (messages.length === 0) {
    sendJson(res, 400, { error: 'Provide a message or messages array.' });
    return;
  }

  const lang = body.lang === 'es' ? 'es' : 'en';
  const system = typeof body.system === 'string' && body.system.trim() ? body.system : SYSTEM_PROMPTS[lang];

  try {
    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: Number(body.max_tokens || 220),
        system,
        messages
      })
    });

    const data = await anthropicResponse.json().catch(() => ({}));
    if (!anthropicResponse.ok) {
      sendJson(res, anthropicResponse.status, {
        error: data.error?.message || 'Anthropic request failed.',
        type: data.error?.type || 'anthropic_error'
      });
      return;
    }

    const reply = data.content?.map(block => block.text || '').join('').trim() || '';
    sendJson(res, 200, { reply, content: data.content, model: data.model || DEFAULT_MODEL });
  } catch (error) {
    sendJson(res, 502, { error: 'Unable to reach Anthropic.', detail: error.message });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/ash-v2.html' : url.pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = join(__dirname, safePath);

  if (!filePath.startsWith(__dirname) || !existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  const contentType = contentTypes[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/health')) {
    sendJson(res, 200, {
      ok: true,
      service: 'ash-phase-1',
      anthropicKeyConfigured: Boolean(getAnthropicApiKey())
    });
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/chat')) {
    await handleChat(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
});

server.listen(PORT, () => {
  console.log(`Ash Phase 1 server listening on http://localhost:${PORT}`);
});
