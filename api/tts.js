import { synthesizeWithPiper } from './_ttsCore.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function sendAudio(res, status, audio, contentType) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(audio);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'vocab local piper tts api',
      usage: 'POST JSON to /api/tts?lang=en with { "text": "..." }.'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const body = parseBody(req);
  const lang = String(req.query?.lang || body.lang || 'en');

  try {
    const result = await synthesizeWithPiper({ text: body.text, lang });
    sendAudio(res, 200, result.audio, result.contentType);
  } catch (error) {
    sendJson(res, error?.statusCode || 502, {
      error: error?.message || 'Piper TTS request failed.',
      detail: String(error?.message || error)
    });
  }
}
