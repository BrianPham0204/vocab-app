// ...new file...
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// deterministic PRNG (mulberry32) + seeded shuffle
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function seededShuffle(items, seedStr) {
  const cloned = [...items];
  const seed = seedFromString(String(seedStr || '0'));
  const rnd = mulberry32(seed);
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function randomShuffle(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function pickDistractors(arr, field, count = 3, seed) {
  const candidates = arr
    .filter((entry) => entry && entry[field] !== undefined && entry[field] !== null && String(entry[field]).trim() !== '')
    .map((entry) => String(entry[field]).trim());
  const unique = Array.from(new Set(candidates));
  return seededShuffle(unique, seed).slice(0, count);
}

export function buildChoiceQuestion(data, mode, index) {
  if (!data || data.length === 0) return null;
  const idx = index % data.length;
  let item = data[idx];
  let actualIdx = idx;
  let others = data.filter((_, i) => i !== actualIdx);
  if (!item) return null;

  if (mode === 'en-to-vi') {
    if (!item.vietnamMeaning || !String(item.vietnamMeaning).trim()) return null;
    const seed = `en-to-vi-${idx}-${item.vocabulary}`;
    const distractors = pickDistractors(others, 'vietnamMeaning', 3, seed + '-d');
    const optsRaw = [String(item.vietnamMeaning).trim(), ...distractors];
    const optsUniq = Array.from(new Set(optsRaw.filter((o) => o && String(o).trim())));
    if (!optsUniq.includes(String(item.vietnamMeaning).trim())) optsUniq.unshift(String(item.vietnamMeaning).trim());
    const options = randomShuffle(optsUniq).slice(0, 4);
    return { id: `${mode}-${idx}`, title: 'Chọn nghĩa đúng', prompt: item.vocabulary, answer: item.vietnamMeaning, options, detail: item, index: idx };
  }

  if (mode === 'vi-to-en') {
    if (!item.vocabulary || !String(item.vocabulary).trim()) return null;
    const seed = `vi-to-en-${idx}-${item.vocabulary}`;
    const distractors = pickDistractors(others, 'vocabulary', 3, seed + '-d');
    const optsRaw = [String(item.vocabulary).trim(), ...distractors];
    const optsUniq = Array.from(new Set(optsRaw.filter((o) => o && String(o).trim())));
    if (!optsUniq.includes(String(item.vocabulary).trim())) optsUniq.unshift(String(item.vocabulary).trim());
    const options = randomShuffle(optsUniq).slice(0, 4);
    return { id: `${mode}-${idx}`, title: 'Chọn từ tiếng Anh đúng', prompt: item.vietnamMeaning, answer: item.vocabulary, options, detail: item, index: idx };
  }

  if (mode === 'mixed') {
    const n = data.length;
    let found = false;
    for (let offset = 0; offset < n; offset += 1) {
      const candIdx = (idx + offset) % n;
      const cand = data[candIdx];
      if (cand && cand.vocabulary && String(cand.vocabulary).trim() && cand.sentences && cand.sentences.en && String(cand.sentences.en).trim()) {
        item = cand; actualIdx = candIdx; others = data.filter((_, i) => i !== actualIdx); found = true; break;
      }
    }
    if (!found) {
      for (let offset = 0; offset < n; offset += 1) {
        const candIdx = (idx + offset) % n;
        const cand = data[candIdx];
        if (cand && cand.vocabulary && String(cand.vocabulary).trim()) {
          item = cand; actualIdx = candIdx; others = data.filter((_, i) => i !== actualIdx); found = true; break;
        }
      }
    }
    if (!found) return null;
    const seed = `mixed-${actualIdx}-${item.vocabulary}`;
    const distractors = pickDistractors(others, 'vocabulary', 3, seed + '-d');
    const optsRaw = [String(item.vocabulary).trim(), ...distractors];
    const optsUniq = Array.from(new Set(optsRaw.filter((o) => o && String(o).trim())));
    if (!optsUniq.includes(String(item.vocabulary).trim())) optsUniq.unshift(String(item.vocabulary).trim());
    const options = randomShuffle(optsUniq).slice(0, 4);

    const enSentence = String(item.sentences?.en || '');
    const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const roughStem = (word) => {
      let w = normalizeText(word);
      if (!w) return '';
      if (w.endsWith('ied') && w.length > 4) return `${w.slice(0, -3)}y`;
      if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
      if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
      return w;
    };
    const looseContains = (a, b) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));

    let prompt = enSentence;
    let blankedToken = String(item.vocabulary || '').trim();
    if (enSentence) {
      const fullWordRegex = new RegExp(`\\b${escapeReg(item.vocabulary)}\\b`, 'i');
      if (fullWordRegex.test(enSentence)) {
        const directMatch = enSentence.match(fullWordRegex);
        if (directMatch && directMatch[0]) blankedToken = directMatch[0];
        prompt = enSentence.replace(fullWordRegex, '____');
      } else {
        // Check each word in sentence: if a word contains/matches answer token (including simple verb inflections), blank that exact word.
        const vocabNorm = normalizeText(item.vocabulary);
        const vocabStem = roughStem(item.vocabulary);
        const vocabParts = String(item.vocabulary)
          .split(/\s+/)
          .map((t) => normalizeText(t))
          .filter(Boolean)
          .sort((a, b) => b.length - a.length);

        const sentenceWordRegex = /\b[A-Za-z'-]+\b/g;
        let matchedToken = null;
        let m;
        while ((m = sentenceWordRegex.exec(enSentence)) !== null) {
          const sentenceToken = m[0];
          const tokenNorm = normalizeText(sentenceToken);
          const tokenStem = roughStem(sentenceToken);
          if (!tokenNorm) continue;

          let matched = false;
          if (tokenNorm === vocabNorm || tokenStem === vocabStem) matched = true;
          if (!matched && (looseContains(tokenNorm, vocabNorm) || looseContains(tokenStem, vocabStem))) matched = true;
          if (!matched) {
            matched = vocabParts.some((part) => {
              const partStem = roughStem(part);
              return (
                tokenNorm === part ||
                tokenStem === partStem ||
                looseContains(tokenNorm, part) ||
                looseContains(tokenStem, partStem)
              );
            });
          }

          if (matched) {
            matchedToken = { start: m.index, end: m.index + sentenceToken.length, text: sentenceToken };
            break;
          }
        }

        if (matchedToken) {
          if (matchedToken.text) blankedToken = matchedToken.text;
          prompt = `${enSentence.slice(0, matchedToken.start)}____${enSentence.slice(matchedToken.end)}`;
        } else {
          const anyWordMatch = enSentence.match(/\b[A-Za-z'-]+\b/);
          if (anyWordMatch) {
            const anyWord = anyWordMatch[0];
            blankedToken = anyWord;
            const anyRegex = new RegExp(`\\b${escapeReg(anyWord)}\\b`);
            prompt = enSentence.replace(anyRegex, '____');
          }
        }
      }
    } else prompt = '____';

    return {
      id: `${mode}-${actualIdx}`,
      title: 'Chọn từ phù hợp vào chỗ trống',
      prompt,
      answer: item.vocabulary,
      options,
      detail: item,
      index: actualIdx,
      fullSentence: enSentence,
      blankedToken
    };
  }

  if (!item.vietnamMeaning || !String(item.vietnamMeaning).trim()) return null;
  const seed = `fallback-${idx}-${item.vocabulary}`;
  const distractors = pickDistractors(others, 'vietnamMeaning', 3, seed + '-d');
  const optsRaw = [String(item.vietnamMeaning).trim(), ...distractors];
  const optsUniq = Array.from(new Set(optsRaw.filter((o) => o && String(o).trim())));
  const options = randomShuffle(optsUniq).slice(0, 4);
  return { id: `${mode}-${idx}`, title: 'Trắc nghiệm', prompt: `Từ: ${item.vocabulary}`, answer: item.vietnamMeaning, options, detail: item, index: idx };
}

export function buildTranslationQuestion(index, translationData) {
  return translationData[index % translationData.length];
}

export function buildWriteWordQuestion(data, index) {
  if (!data || data.length === 0) return null;
  const idx = index % data.length;
  const item = data[idx];
  if (!item) return null;
  if (!item.vocabulary || !item.vietnamMeaning) return null;
  return { id: `write-word-${idx}`, title: 'Viết lại từ', prompt: item.vietnamMeaning, answer: item.vocabulary, options: [], detail: item, index: idx };
}
// ...end file...
