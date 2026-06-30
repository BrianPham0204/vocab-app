import http from 'node:http';
import { synthesizeWithPiper } from '../api/_ttsCore.js';

const PORT = Number(process.env.TTS_PORT || 4320);
const HOST = process.env.TTS_HOST || '127.0.0.1';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function sendAudio(res, status, audio, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(audio);
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
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname !== '/api/tts') {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'local vocab piper tts api',
      usage: 'POST JSON to this endpoint with text. Use ?lang=en.'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await synthesizeWithPiper({
      text: body.text,
      lang: url.searchParams.get('lang') || body.lang || 'en'
    });
    sendAudio(res, 200, result.audio, result.contentType);
  } catch (error) {
    sendJson(res, error?.statusCode || 502, {
      error: error?.message || 'Piper TTS request failed.',
      detail: String(error?.message || error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local Piper TTS API: http://${HOST}:${PORT}/api/tts?lang=en`);
});
