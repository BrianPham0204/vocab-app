export async function requestTtsAudio({
  endpoint = '/api/tts?lang=en',
  text,
  lang = 'en',
  signal
}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Missing TTS text.');
  }

  const resolvedEndpoint = resolveTtsEndpoint(endpoint, lang);
  const response = await fetch(resolvedEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: cleanText,
      lang
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`TTS request failed (${response.status}).`);
  }

  return response.blob();
}

function resolveTtsEndpoint(endpoint, lang) {
  const base = String(endpoint || '/api/tts?lang=en').trim();
  const url = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.set('lang', String(lang || 'en').split('-')[0]);

  if (
    typeof window !== 'undefined'
    && url.pathname === '/api/tts'
    && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.port !== '4320'
  ) {
    url.protocol = 'http:';
    url.hostname = '127.0.0.1';
    url.port = '4320';
  }

  return url.toString();
}
