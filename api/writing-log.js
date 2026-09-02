import { createSign } from 'node:crypto';

const DEFAULT_SPREADSHEET_ID = '1mVSZiur6rR9fBnMRPqLDSqrifFKgGEIYw-Rza_UZELc';
const DEFAULT_WRITING_GID = '239920199';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getServiceAccountCredentials() {
  const rawJson = stripWrappingQuotes(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_CREDENTIALS_JSON);
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key
    };
  }

  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY
  };
}

function stripWrappingQuotes(value) {
  let next = String(value || '').trim();
  while (
    next.length >= 2
    && ((next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'")))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function normalizePrivateKey(value) {
  return stripWrappingQuotes(value).replace(/\\n/g, '\n');
}

function createJwt({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const claim = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(normalizePrivateKey(privateKey), 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsigned}.${signature}`;
}

async function getAccessToken() {
  const credentials = getServiceAccountCredentials();
  if (!credentials.clientEmail || !credentials.privateKey) {
    const error = new Error('Google Sheets credentials are not configured.');
    error.statusCode = 500;
    throw error;
  }

  const assertion = createJwt(credentials);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || 'Failed to authorize Google Sheets.');
    error.statusCode = response.status || 502;
    throw error;
  }

  return payload.access_token;
}

async function resolveSheetTitle({ spreadsheetId, gid, accessToken }) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set('fields', 'sheets(properties(sheetId,title))');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Failed to read spreadsheet metadata.');
    error.statusCode = response.status;
    throw error;
  }

  const numericGid = Number(gid);
  const sheet = (payload.sheets || []).find((item) => Number(item?.properties?.sheetId) === numericGid);
  if (!sheet?.properties?.title) {
    const error = new Error(`Could not find a sheet tab with gid ${gid}.`);
    error.statusCode = 404;
    throw error;
  }

  return sheet.properties.title;
}

function quoteSheetTitle(title) {
  return `'${String(title || '').replace(/'/g, "''")}'`;
}

async function appendWritingLog({ words, answer }) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const gid = process.env.GOOGLE_SHEETS_WRITING_GID || DEFAULT_WRITING_GID;
  const accessToken = await getAccessToken();
  const sheetTitle = await resolveSheetTitle({ spreadsheetId, gid, accessToken });
  const range = `${quoteSheetTitle(sheetTitle)}!A:B`;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set('valueInputOption', 'USER_ENTERED');
  url.searchParams.set('insertDataOption', 'INSERT_ROWS');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [[words, answer]]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Failed to append writing log.');
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function checkWritingLogConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const gid = process.env.GOOGLE_SHEETS_WRITING_GID || DEFAULT_WRITING_GID;
  const credentials = getServiceAccountCredentials();
  const accessToken = await getAccessToken();
  const sheetTitle = await resolveSheetTitle({ spreadsheetId, gid, accessToken });

  return {
    ok: true,
    spreadsheetId,
    writingGid: String(gid),
    serviceAccountEmail: credentials.clientEmail || '',
    privateKeyConfigured: Boolean(credentials.privateKey),
    targetSheetTitle: sheetTitle
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET') {
    try {
      sendJson(res, 200, await checkWritingLogConfig());
    } catch (error) {
      sendJson(res, error?.statusCode || 500, {
        ok: false,
        error: error?.message || 'Writing log configuration check failed.'
      });
    }
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const body = await parseBody(req);
    const words = Array.isArray(body.words)
      ? body.words.map((word) => String(word || '').trim()).filter(Boolean).join(' | ')
      : String(body.words || '').trim();
    const answer = String(body.answer || body.content || '').trim();

    if (!answer) {
      sendJson(res, 400, { error: 'Missing writing answer.' });
      return;
    }

    await appendWritingLog({ words, answer });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, {
      error: error?.message || 'Could not save writing answer.',
      detail: String(error?.message || error)
    });
  }
}
