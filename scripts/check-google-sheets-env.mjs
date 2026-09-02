import fs from 'node:fs';
import { createSign } from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function readEnv(path = '.env') {
  const env = {};
  const content = fs.readFileSync(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^"/, '').replace(/"$/, '');
    env[key] = value;
  }
  return env;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJwt({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64Url(JSON.stringify({
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    }))
  ].join('.');

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey.replace(/\\n/g, '\n'), 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsigned}.${signature}`;
}

const env = readEnv();
const required = [
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SHEETS_WRITING_GID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY'
];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  throw new Error(`Missing env vars: ${missing.join(', ')}`);
}

const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: createJwt({
      clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: env.GOOGLE_PRIVATE_KEY
    })
  })
});
const tokenPayload = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenPayload.access_token) {
  throw new Error(tokenPayload.error_description || tokenPayload.error || 'Failed to authorize with Google.');
}

const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_SPREADSHEET_ID}`);
metadataUrl.searchParams.set('fields', 'sheets(properties(sheetId,title))');
const metadataResponse = await fetch(metadataUrl, {
  headers: {
    Authorization: `Bearer ${tokenPayload.access_token}`
  }
});
const metadata = await metadataResponse.json().catch(() => ({}));
if (!metadataResponse.ok) {
  throw new Error(metadata?.error?.message || 'Failed to read spreadsheet metadata.');
}

const targetSheet = (metadata.sheets || []).find((sheet) => (
  String(sheet?.properties?.sheetId) === String(env.GOOGLE_SHEETS_WRITING_GID)
));

let appendTest = null;
if (process.argv.includes('--append-test')) {
  if (!targetSheet?.properties?.title) {
    throw new Error(`Could not find target gid ${env.GOOGLE_SHEETS_WRITING_GID}; skipping append test.`);
  }

  const sheetTitle = targetSheet.properties.title;
  const range = `'${String(sheetTitle).replace(/'/g, "''")}'!A:B`;
  const appendUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append`);
  appendUrl.searchParams.set('valueInputOption', 'USER_ENTERED');
  appendUrl.searchParams.set('insertDataOption', 'INSERT_ROWS');

  const appendResponse = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [[
        `Codex SA write test ${new Date().toISOString()}`,
        'If you can see this row, Google Sheets write permission works.'
      ]]
    })
  });
  const appendPayload = await appendResponse.json().catch(() => ({}));
  if (!appendResponse.ok) {
    throw new Error(appendPayload?.error?.message || 'Append test failed.');
  }
  appendTest = {
    ok: true,
    updatedRange: appendPayload?.updates?.updatedRange || null
  };
}

console.log(JSON.stringify({
  tokenOk: true,
  spreadsheetReadable: true,
  targetGidFound: Boolean(targetSheet),
  targetTitle: targetSheet?.properties?.title || null,
  serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  appendTest
}, null, 2));
