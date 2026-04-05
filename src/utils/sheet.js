export function convertSheetUrlToCsv(url) {
  // sanitize possible extra quotes / whitespace
  const raw = String(url || '').trim();
  const clean = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();

  try {
    const u = new URL(clean);
    if (u.hostname.includes('docs.google.com') && u.pathname.includes('/spreadsheets/')) {
      const match = u.pathname.match(/\/d\/([^/]+)/);
      const id = match ? match[1] : null;
      const gid = u.hash ? new URLSearchParams(u.hash.replace('#', '')).get('gid') : '0';
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid || '0'}`;
    }
  } catch (e) {
    // not a valid URL — fall back to the cleaned value (could be a direct CSV URL)
  }
  return clean;
}

export async function fetchCsvAsText(csvUrl) {
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

export function parseCSV(csvText) {
  // lightweight parser that handles quoted fields and CRLF/LF
  const rows = [];
  let cur = '';
  let inQuotes = false;
  let row = [];
  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // handle CRLF
      if (ch === '\r' && csvText[i + 1] === '\n') continue;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h || '').trim());
  const dataRows = rows.slice(1).map((r) => {
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i] || `col${i}`] = r[i] !== undefined ? r[i] : '';
    }
    return obj;
  });
  return { headers, rows: dataRows };
}

export function mapSheetRowsToData(rows, mapping) {
  // mapping: { vocabulary, type, pronun, vietnamMeaning, wordFamily, synonym, collocation, pattern, sentences_en, sentences_vi, learn }
  // normalize rows: since CSV headers can vary in case/spacing, attempt to resolve mapping keys safely

  const normalizeKey = (k = '') => String(k || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/gi, '');

  const resolve = (row, key) => {
  if (!key || !row) return '';
  
  // 1. Thử khớp chính xác tuyệt đối
  if (row[key] !== undefined) return row[key];

  // 2. Thử khớp sau khi đã normalize (xóa dấu, viết thường, xóa khoảng trắng)
  const nk = normalizeKey(key);
  const rowKeys = Object.keys(row);
  
  const exactNormKey = rowKeys.find(rk => normalizeKey(rk) === nk);
  if (exactNormKey) return row[exactNormKey];

  // 3. Chỉ dùng include nếu thực sự không tìm thấy cái nào khớp 100%
  const looseKey = rowKeys.find(rk => normalizeKey(rk).includes(nk));
  return looseKey ? row[looseKey] : '';
};

  return rows.map((r) => {
    const vocab = resolve(r, mapping.vocabulary);
    const type = resolve(r, mapping.type);
    const pronun = resolve(r, mapping.pronun);
    const learn = resolve(r, mapping.learn);
    const vietnamMeaning = resolve(r, mapping.vietnamMeaning);
    const wordFamily = resolve(r, mapping.wordFamily);
    const synonym = resolve(r, mapping.synonym);
    const collocation = resolve(r, mapping.collocation);
    const pattern = resolve(r, mapping.pattern || mapping.partern);
    const sentences_en = resolve(r, mapping.sentences_en);
    const sentences_vi = resolve(r, mapping.sentences_vi);
    return {
      vocabulary: String(vocab || '').trim(),
      type: String(type || '').trim(),
      pronun: String(pronun || '').trim(),
      learn: String(learn || '').trim(),
      wordFamily: String(wordFamily || '').trim(),
      synonym: String(synonym || '').trim(),
      collocation: String(collocation || '').trim(),
      pattern: String(pattern || '').trim(),
      vietnamMeaning: String(vietnamMeaning || '').trim(),
      sentences: { en: String(sentences_en || '').trim(), vi: String(sentences_vi || '').trim() }
    };
  }).filter((it) => it.vocabulary && (it.vietnamMeaning || it.sentences.en || it.sentences.vi || it.learn));
}
