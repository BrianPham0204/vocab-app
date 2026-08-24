export async function requestTranslation({
  endpoint,
  text,
  sourceLang = 'en',
  targetLang = 'vi',
  signal
}) {
  const safeText = String(text || '').trim();
  if (!safeText) {
    throw new Error('Missing text.');
  }

  try {
    if (!endpoint) {
      throw new Error('Missing translation endpoint.');
    }

    return await requestEndpointTranslation({
      endpoint,
      text: safeText,
      sourceLang,
      targetLang,
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    try {
      return await requestGoogleTranslateFallback({
        text: safeText,
        sourceLang,
        targetLang,
        signal
      });
    } catch (fallbackError) {
      if (signal?.aborted) throw fallbackError;
      return requestMyMemoryFallback({
        text: safeText,
        sourceLang,
        targetLang,
        signal
      });
    }
  }
}

async function requestEndpointTranslation({
  endpoint,
  text,
  sourceLang,
  targetLang,
  signal
}) {
  const resolvedEndpoint = resolveTranslationEndpoint(endpoint);
  const response = await fetch(resolvedEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      sourceLang,
      targetLang
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Translation request failed (${response.status}).`);
  }

  const json = await response.json();
  const translatedText =
    json?.translatedText ||
    json?.translation ||
    json?.result ||
    json?.output ||
    json?.data?.translatedText ||
    json?.data?.translation ||
    json?.data?.result ||
    json?.data?.translations?.[0]?.translatedText ||
    json?.translations?.[0]?.translatedText;

  if (!translatedText) {
    throw new Error('Translation response was missing translated text.');
  }

  return {
    translatedText: String(translatedText).trim(),
    provider: json?.provider || 'api'
  };
}

async function requestGoogleTranslateFallback({
  text,
  sourceLang,
  targetLang,
  signal
}) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', normalizeLang(sourceLang, 'auto'));
  url.searchParams.set('tl', normalizeLang(targetLang, 'vi'));
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Google Translate request failed (${response.status}).`);
  }

  const payload = await response.json();
  const translatedText = parseGoogleTranslateResponse(payload);
  if (!translatedText) {
    throw new Error('Translation response was empty.');
  }

  return {
    translatedText,
    provider: 'google-translate-free'
  };
}

function parseGoogleTranslateResponse(payload) {
  if (!Array.isArray(payload?.[0])) return '';
  return payload[0]
    .map((segment) => Array.isArray(segment) ? segment[0] : '')
    .filter(Boolean)
    .join('')
    .trim();
}

function normalizeLang(value, fallback) {
  const lang = String(value || '').trim().toLowerCase();
  if (!lang) return fallback;
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(lang) && lang !== 'auto') return fallback;
  return lang;
}

async function requestMyMemoryFallback({
  text,
  sourceLang,
  targetLang,
  signal
}) {
  const source = normalizeLang(sourceLang, 'en') === 'auto' ? 'en' : normalizeLang(sourceLang, 'en');
  const target = normalizeLang(targetLang, 'vi');
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${source}|${target}`);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Fallback translation request failed (${response.status}).`);
  }

  const json = await response.json();
  const translatedText =
    json?.responseData?.translatedText ||
    json?.matches?.find((match) => match?.translation)?.translation;

  if (!translatedText) {
    throw new Error('Fallback translation response was empty.');
  }

  return {
    translatedText: String(translatedText).trim(),
    provider: 'mymemory'
  };
}

function resolveTranslationEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (
    value === '/api/translate'
    && typeof window !== 'undefined'
    && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.port !== '4310'
  ) {
    return 'http://127.0.0.1:4310/api/translate';
  }
  return value;
}
