export const MAX_TEXT_LENGTH = 1800;
export const DEFAULT_SOURCE_LANG = 'auto';
export const DEFAULT_TARGET_LANG = 'vi';

export function normalizeLang(value, fallback) {
  const lang = String(value || '').trim().toLowerCase();
  if (!lang) return fallback;
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(lang) && lang !== 'auto') return fallback;
  return lang;
}

function parseGoogleTranslateResponse(payload) {
  if (!Array.isArray(payload?.[0])) return '';
  return payload[0]
    .map((segment) => Array.isArray(segment) ? segment[0] : '')
    .filter(Boolean)
    .join('');
}

export async function translateWithGoogleFree({
  text,
  sourceLang = DEFAULT_SOURCE_LANG,
  targetLang = DEFAULT_TARGET_LANG
}) {
  const safeText = String(text || '').trim();
  if (!safeText) {
    const error = new Error('Missing text.');
    error.statusCode = 400;
    throw error;
  }

  if (safeText.length > MAX_TEXT_LENGTH) {
    const error = new Error(`Text is too long. Max ${MAX_TEXT_LENGTH} characters.`);
    error.statusCode = 413;
    throw error;
  }

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', normalizeLang(sourceLang, DEFAULT_SOURCE_LANG));
  url.searchParams.set('tl', normalizeLang(targetLang, DEFAULT_TARGET_LANG));
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', safeText);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 vocab-app'
    }
  });

  if (!response.ok) {
    const error = new Error(`Google Translate request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  const translatedText = parseGoogleTranslateResponse(payload).trim();
  if (!translatedText) {
    const error = new Error('Translation response was empty.');
    error.statusCode = 502;
    throw error;
  }

  return {
    translatedText,
    provider: 'google-translate-free'
  };
}
