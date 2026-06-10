import { createReadStream, existsSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/;
const MAX_BODY_BYTES = 1024 * 1024;
const ANTHROPIC_TIMEOUT_MS = 30000;
const TAVUS_API_URL = 'https://tavusapi.com/v2';
const TAVUS_PERSONA_ID = process.env.TAVUS_PERSONA_ID || 'p3ebb7951fa5';
const TAVUS_REPLICA_ID = process.env.TAVUS_REPLICA_ID || 'rdf61be0d4e1';
const TAVUS_LLM_MODEL = process.env.TAVUS_LLM_MODEL || 'ash-claude';
const RENDER_BRAIN_URL = (process.env.ASH_BRAIN_URL || 'https://ash-avsar.onrender.com').replace(/\/$/, '');

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

function sendSse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function verifyLlmAccess(req) {
  const expectedKey = process.env.ASH_LLM_API_KEY || process.env.TAVUS_LLM_API_KEY || '';
  if (!expectedKey) {
    return true;
  }

  return getBearerToken(req) === expectedKey || req.headers['x-api-key'] === expectedKey;
}

function isConfigured(value) {
  return Boolean(String(value || '').trim());
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

function hostnameMatchesNoProxy(hostname, noProxyValue) {
  return noProxyValue
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
    .some(entry => {
      if (entry === '*') {
        return true;
      }

      const normalizedEntry = entry.startsWith('.') ? entry.slice(1) : entry;
      const normalizedHostname = hostname.toLowerCase();
      return normalizedHostname === normalizedEntry || normalizedHostname.endsWith(`.${normalizedEntry}`);
    });
}

function getProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  if (hostnameMatchesNoProxy(targetUrl.hostname, noProxy)) {
    return '';
  }

  if (targetUrl.protocol === 'https:') {
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  }

  return process.env.HTTP_PROXY || process.env.http_proxy || '';
}

function requestJson(url, options, payload) {
  const targetUrl = new URL(url);
  const body = JSON.stringify(payload);
  const headers = {
    ...options.headers,
    'Content-Length': Buffer.byteLength(body)
  };
  const proxyUrl = getProxyUrl(targetUrl);

  if (targetUrl.protocol === 'https:' && proxyUrl) {
    return requestJsonViaHttpProxy(targetUrl, new URL(proxyUrl), options.method, headers, body);
  }

  return requestJsonDirect(targetUrl, options.method, headers, body);
}

function requestJsonDirect(targetUrl, method, headers, body) {
  const transport = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method,
      headers,
      timeout: ANTHROPIC_TIMEOUT_MS
    }, res => collectJsonResponse(res, resolve, reject));

    req.on('timeout', () => req.destroy(new Error('Anthropic request timed out.')));
    req.on('error', reject);
    req.end(body);
  });
}

function requestJsonViaHttpProxy(targetUrl, proxyUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const proxyReq = httpRequest({
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: 'CONNECT',
      path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
      headers: proxyUrl.username || proxyUrl.password ? {
        'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`
      } : undefined,
      timeout: ANTHROPIC_TIMEOUT_MS
    });

    proxyReq.on('connect', (proxyRes, socket) => {
      if (proxyRes.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with status ${proxyRes.statusCode}.`));
        return;
      }

      const req = httpsRequest({
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers,
        socket,
        servername: targetUrl.hostname,
        timeout: ANTHROPIC_TIMEOUT_MS
      }, res => collectJsonResponse(res, resolve, reject));

      req.on('timeout', () => req.destroy(new Error('Anthropic request timed out.')));
      req.on('error', reject);
      req.end(body);
    });

    proxyReq.on('timeout', () => proxyReq.destroy(new Error('Proxy CONNECT timed out.')));
    proxyReq.on('error', reject);
    proxyReq.end();
  });
}

function collectJsonResponse(res, resolve, reject) {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let data = {};

    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { error: { message: rawBody } };
      }
    }

    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
  });
  res.on('error', reject);
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

function normalizeOpenAiMessages(body) {
  if (!Array.isArray(body.messages)) {
    return { system: '', messages: [] };
  }

  const systemMessages = [];
  const messages = [];

  for (const message of body.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
      continue;
    }

    const content = extractOpenAiContent(message.content).slice(0, 8000);
    if (!content) {
      continue;
    }

    if (message.role === 'system') {
      systemMessages.push(content);
    } else {
      messages.push({ role: message.role, content });
    }
  }

  return { system: systemMessages.join('\n\n'), messages };
}

function extractOpenAiContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join(' ')
      .trim();
  }

  return '';
}

function toOpenAiChatCompletion({ model, reply }) {
  const id = `chatcmpl-ash-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: reply },
      finish_reason: 'stop'
    }]
  };
}

function toOpenAiStreamEvents({ model, reply }) {
  const id = `chatcmpl-ash-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return [
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    },
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content: reply }, finish_reason: null }]
    },
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    }
  ];
}

async function askAnthropic({ messages, system, maxTokens = 220 }) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    const error = new Error('ANTHROPIC_API_KEY is not configured.');
    error.statusCode = 500;
    throw error;
  }

  const anthropicResponse = await requestJson(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': apiKey
    }
  }, {
    model: DEFAULT_MODEL,
    max_tokens: Number(maxTokens || 220),
    system,
    messages
  });

  const data = anthropicResponse.data;
  if (!anthropicResponse.ok) {
    const error = new Error(data.error?.message || 'Anthropic request failed.');
    error.statusCode = anthropicResponse.status;
    error.type = data.error?.type || 'anthropic_error';
    throw error;
  }

  return {
    reply: data.content?.map(block => block.text || '').join('').trim() || '',
    content: data.content,
    model: data.model || DEFAULT_MODEL
  };
}

async function handleOpenAiChatCompletions(req, res) {
  if (!verifyLlmAccess(req)) {
    sendJson(res, 401, { error: { message: 'Unauthorized.', type: 'authentication_error' } });
    return;
  }

  let body;
  try {
    const rawBody = await readRequestBody(req);
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid JSON request body.', type: 'invalid_request_error' } });
    return;
  }

  const { system, messages } = normalizeOpenAiMessages(body);
  if (messages.length === 0) {
    sendJson(res, 400, { error: { message: 'Provide a messages array.', type: 'invalid_request_error' } });
    return;
  }

  const defaultSystem = `${SYSTEM_PROMPTS.en}\n\nYou are speaking through Tavus Conversational Video Interface. Tavus handles your face, voice, speech recognition, and video presence. The customer's transcribed speech is sent here, and this Render app supplies your Claude-powered Clark's woodworking brain. Keep every answer natural for speech.`;
  const model = body.model || TAVUS_LLM_MODEL;

  try {
    const result = await askAnthropic({
      messages,
      system: system || defaultSystem,
      maxTokens: body.max_tokens || 180
    });

    if (body.stream) {
      sendSse(res, toOpenAiStreamEvents({ model, reply: result.reply }));
      return;
    }

    sendJson(res, 200, toOpenAiChatCompletion({ model, reply: result.reply }));
  } catch (error) {
    sendJson(res, error.statusCode || 502, {
      error: {
        message: error.statusCode === 500 ? error.message : 'Unable to generate Ash response.',
        detail: error.message,
        type: error.type || 'ash_brain_error'
      }
    });
  }
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
    const anthropicResponse = await requestJson(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey
      }
    }, {
      model: DEFAULT_MODEL,
      max_tokens: Number(body.max_tokens || 220),
      system,
      messages
    });

    const data = anthropicResponse.data;
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

function getPublicBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `https://${req.headers.host}`).replace(/\/$/, '');
}

function getTavusApiKey() {
  return (process.env.TAVUS_API_KEY || '').trim();
}

async function handleTavusConversation(req, res) {
  const apiKey = getTavusApiKey();
  if (!apiKey) {
    sendJson(res, 500, { error: 'TAVUS_API_KEY is not configured.' });
    return;
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      const rawBody = await readRequestBody(req);
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON request body.' });
      return;
    }
  }

  const publicBaseUrl = getPublicBaseUrl(req);
  const payload = {
    replica_id: body.replica_id || TAVUS_REPLICA_ID,
    persona_id: body.persona_id || TAVUS_PERSONA_ID,
    conversation_name: body.conversation_name || `Ash at Clark's ${new Date().toISOString()}`,
    callback_url: body.callback_url || `${publicBaseUrl}/api/tavus/callback`,
    custom_greeting: body.custom_greeting || "Hi, I'm Ash. Welcome to Clark's Hardwood Lumber. What are you working on today?",
    conversational_context: body.conversational_context || "You are Ash for Clark's Hardwood Lumber. Use the Claude-powered Render brain configured on this persona for woodworking and Clark's store knowledge.",
    properties: {
      ...(body.properties || {}),
      enable_prejoin_ui: body.properties?.enable_prejoin_ui ?? false,
      participant_left_timeout: body.properties?.participant_left_timeout || 60
    }
  };

  try {
    const tavusResponse = await requestJson(`${TAVUS_API_URL}/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      }
    }, payload);

    if (!tavusResponse.ok) {
      sendJson(res, tavusResponse.status, {
        error: tavusResponse.data.message || tavusResponse.data.error || 'Tavus conversation creation failed.',
        detail: tavusResponse.data
      });
      return;
    }

    sendJson(res, 200, tavusResponse.data);
  } catch (error) {
    sendJson(res, 502, { error: 'Unable to reach Tavus.', detail: error.message });
  }
}

async function handleTavusPersonaConfiguration(req, res) {
  const apiKey = getTavusApiKey();
  if (!apiKey) {
    sendJson(res, 500, { error: 'TAVUS_API_KEY is not configured.' });
    return;
  }

  let body = {};
  try {
    const rawBody = await readRequestBody(req);
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON request body.' });
    return;
  }

  const publicBaseUrl = getPublicBaseUrl(req);
  const llmApiKey = process.env.ASH_LLM_API_KEY || process.env.TAVUS_LLM_API_KEY || '';
  if (!llmApiKey) {
    sendJson(res, 500, { error: 'ASH_LLM_API_KEY or TAVUS_LLM_API_KEY is required before configuring Tavus.' });
    return;
  }

  const personaId = TAVUS_PERSONA_ID;
  const patch = [
    { op: 'replace', path: '/default_replica_id', value: TAVUS_REPLICA_ID },
    { op: 'replace', path: '/layers/llm/model', value: TAVUS_LLM_MODEL },
    { op: 'replace', path: '/layers/llm/base_url', value: `${publicBaseUrl}/v1` },
    { op: 'replace', path: '/layers/llm/api_key', value: llmApiKey },
    { op: 'replace', path: '/layers/llm/speculative_inference', value: true }
  ];

  try {
    const tavusResponse = await requestJson(`${TAVUS_API_URL}/personas/${encodeURIComponent(personaId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      }
    }, patch);

    if (!tavusResponse.ok && tavusResponse.status !== 304) {
      sendJson(res, tavusResponse.status, {
        error: tavusResponse.data.message || tavusResponse.data.error || 'Tavus persona configuration failed.',
        detail: tavusResponse.data
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      persona_id: personaId,
      replica_id: TAVUS_REPLICA_ID,
      llm: {
        model: TAVUS_LLM_MODEL,
        base_url: `${publicBaseUrl}/v1`,
        api_key_configured: true
      },
      tavusStatus: tavusResponse.status
    });
  } catch (error) {
    sendJson(res, 502, { error: 'Unable to configure Tavus persona.', detail: error.message });
  }
}

async function handleTavusCallback(req, res) {
  try {
    await readRequestBody(req);
  } catch {
    // Webhooks should not break Tavus retries because of a malformed or oversized body.
  }
  sendJson(res, 200, { ok: true });
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
      anthropicKeyConfigured: Boolean(getAnthropicApiKey()),
      tavusKeyConfigured: Boolean(getTavusApiKey()),
      tavusPersonaId: TAVUS_PERSONA_ID,
      tavusReplicaId: TAVUS_REPLICA_ID,
      tavusLlmModel: TAVUS_LLM_MODEL,
      tavusLlmAuthConfigured: isConfigured(process.env.ASH_LLM_API_KEY || process.env.TAVUS_LLM_API_KEY),
      renderBrainUrl: RENDER_BRAIN_URL
    });
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/chat')) {
    await handleChat(req, res);
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
    await handleOpenAiChatCompletions(req, res);
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/tavus/conversations')) {
    await handleTavusConversation(req, res);
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/tavus/configure-persona')) {
    await handleTavusPersonaConfiguration(req, res);
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/tavus/callback')) {
    await handleTavusCallback(req, res);
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
