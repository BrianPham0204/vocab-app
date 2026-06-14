import http from 'node:http';
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, normalizeLang, translateWithGoogleFree } from '../api/_translateCore.js';

const PORT = Number(process.env.TRANSLATE_PORT || 4310);
const HOST = process.env.TRANSLATE_HOST || '127.0.0.1';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url !== '/api/translate') {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'local vocab translate api',
      usage: 'POST JSON to this endpoint with text, sourceLang, and targetLang.'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await translateWithGoogleFree({
      text: body.text,
      sourceLang: normalizeLang(body.sourceLang, DEFAULT_SOURCE_LANG),
      targetLang: normalizeLang(body.targetLang, DEFAULT_TARGET_LANG)
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error?.statusCode || 502, {
      error: error?.message || 'Translation provider request failed.',
      detail: String(error?.message || error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local translate API: http://${HOST}:${PORT}/api/translate`);
});
