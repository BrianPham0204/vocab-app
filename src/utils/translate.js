export async function requestTranslation({
  endpoint,
  text,
  sourceLang = 'en',
  targetLang = 'vi',
  signal
}) {
  if (!endpoint) {
    throw new Error('Missing translation endpoint.');
  }

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
