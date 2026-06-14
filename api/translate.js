import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, normalizeLang, translateWithGoogleFree } from './_translateCore.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
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
      service: 'vocab translate api',
      usage: 'POST JSON to this endpoint with text, sourceLang, and targetLang.'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const body = parseBody(req);
  const text = String(body.text || '').trim();
  const sourceLang = normalizeLang(body.sourceLang, DEFAULT_SOURCE_LANG);
  const targetLang = normalizeLang(body.targetLang, DEFAULT_TARGET_LANG);

  try {
    const result = await translateWithGoogleFree({ text, sourceLang, targetLang });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error?.statusCode || 502, {
      error: error?.message || 'Translation provider request failed.',
      detail: String(error?.message || error)
    });
  }
}
