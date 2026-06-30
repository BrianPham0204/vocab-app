/**
 * create-story.mjs
 *
 * Usage:
 *   node scripts/create-story.mjs --words "focus,practice,memory" [--format narrative|dialogue|interview|podcast] [--context "morning commute"]
 *
 * Pipeline:
 *   1. Gen story JSON via OpenRouter (free models)
 *   2. Render per-sentence WAV via Piper
 *   3. Upload everything to Cloudflare R2
 *   4. Print story JSON URL to stdout
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config();

// ── Config ────────────────────────────────────────────────────────────────────
const R2_ACCOUNT_ID    = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET        = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET        = process.env.R2_BUCKET || 'vocab-audio';
const R2_PUBLIC_URL    = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
const PIPER_BIN        = process.env.PIPER_BIN || 'C:\\piper\\piper\\piper.exe';
const PIPER_MODEL      = process.env.PIPER_EN_MODEL;
const PIPER_CONFIG     = process.env.PIPER_EN_CONFIG;
const OR_API_KEY       = process.env.OPENROUTER_API_KEY;

const OR_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-120b:free',
];

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { words: [], format: 'narrative', context: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--words'   && args[i + 1]) result.words   = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    if (args[i] === '--format'  && args[i + 1]) result.format  = args[++i];
    if (args[i] === '--context' && args[i + 1]) result.context = args[++i];
  }
  return result;
}

// ── OpenRouter story gen ──────────────────────────────────────────────────────
const FORMAT_INSTRUCTIONS = {
  narrative: 'a first-person narrative story',
  dialogue:  'a conversation between two people, using "A:" and "B:" turn prefixes',
  interview: 'an interview, using "Host:" and "Guest:" turn prefixes',
  podcast:   'a podcast monologue',
};

async function genStory({ words, format, context }) {
  const desc       = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS.narrative;
  const wordList   = words.join(', ');
  const ctxNote    = context ? `The setting or topic is: "${context}". ` : '';

  const prompt = `Write ${desc} that uses ALL of these vocabulary words naturally: ${wordList}. ${ctxNote}

Output ONLY a raw JSON object — no markdown fences, no explanation:
{
  "sentences": [
    { "text": "First complete sentence.", "words": ["vocab1"] },
    { "text": "Second complete sentence.", "words": ["vocab2", "vocab3"] }
  ]
}

Rules:
- 8 to 14 sentences total
- Each entry is ONE complete sentence ending with . ! or ?
- "words" lists which target vocab words appear in that sentence (empty array [] if none)
- Tone: natural and engaging`;

  let lastError;
  for (const model of OR_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OR_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vocab-app.vercel.app',
          'X-Title': 'Vocab App',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.75,
          max_tokens: 1800,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data    = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const match   = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');

      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed.sentences) || !parsed.sentences.length) {
        throw new Error('Invalid story JSON');
      }

      console.error(`[gen] model: ${model} → ${parsed.sentences.length} sentences`);
      return parsed.sentences;
    } catch (e) {
      console.error(`[gen] ${model} failed: ${e.message}`);
      lastError = e;
    }
  }
  throw lastError || new Error('All OpenRouter models failed');
}

// ── Piper TTS ─────────────────────────────────────────────────────────────────
function piperSynth(text, outputFile) {
  return new Promise((resolve, reject) => {
    const args = ['--model', PIPER_MODEL, '--output_file', outputFile];
    if (PIPER_CONFIG) args.push('--config', PIPER_CONFIG);

    const child = spawn(PIPER_BIN, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Piper exited ${code}`));
    });
    child.stdin.end(`${text}\n`);
  });
}

// ── R2 upload ─────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET },
});

async function upload(localPath, key, contentType) {
  const body = await fs.readFile(localPath);
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { words, format, context } = parseArgs(process.argv);

  if (!words.length) {
    console.error('Usage: node scripts/create-story.mjs --words "word1,word2,word3" [--format narrative] [--context "topic"]');
    process.exit(1);
  }
  if (!OR_API_KEY)   { console.error('Missing OPENROUTER_API_KEY in .env'); process.exit(1); }
  if (!PIPER_MODEL)  { console.error('Missing PIPER_EN_MODEL in .env or system env'); process.exit(1); }
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET) {
    console.error('Missing R2 credentials in .env'); process.exit(1);
  }
  if (!R2_PUBLIC_URL) {
    console.error('Missing R2_PUBLIC_URL in .env'); process.exit(1);
  }

  const storyId = `story-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tmpDir  = path.join(os.tmpdir(), storyId);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    // 1. Gen story text
    console.error(`\n[1/3] Generating story (${words.length} words, format: ${format})...`);
    const rawSentences = await genStory({ words, format, context });

    // 2. Render audio per sentence
    console.error(`[2/3] Rendering ${rawSentences.length} sentences with Piper...`);
    const rendered = [];
    for (let i = 0; i < rawSentences.length; i++) {
      const { text, words: usedWords = [] } = rawSentences[i];
      const wavPath = path.join(tmpDir, `${i}.wav`);
      await piperSynth(text, wavPath);
      rendered.push({ index: i, text, words: usedWords, localWav: wavPath });
      process.stderr.write(`  [${i + 1}/${rawSentences.length}] done\r`);
    }
    process.stderr.write('\n');

    // 3. Upload WAVs + manifest JSON
    console.error('[3/3] Uploading to R2...');
    const sentences = [];
    for (const s of rendered) {
      const key      = `stories/${storyId}/${s.index}.wav`;
      const audioUrl = await upload(s.localWav, key, 'audio/wav');
      sentences.push({ index: s.index, text: s.text, words: s.words, audioUrl });
    }

    const manifest = {
      id: storyId,
      createdAt: new Date().toISOString(),
      format,
      context: context || '',
      words,
      sentences,
    };

    const jsonPath = path.join(tmpDir, 'story.json');
    await fs.writeFile(jsonPath, JSON.stringify(manifest, null, 2));
    const jsonUrl = await upload(jsonPath, `stories/${storyId}/story.json`, 'application/json');

    // Output result to stdout (pipe-friendly)
    console.log(JSON.stringify({ storyId, jsonUrl, sentences: sentences.length }, null, 2));
    console.error('\nDone.');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
