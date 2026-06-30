import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeLang(lang) {
  return String(lang || 'en').trim().toLowerCase().split('-')[0] || 'en';
}

function getPiperConfig(lang) {
  const normalized = normalizeLang(lang);
  if (normalized !== 'en') {
    throw createHttpError('Piper endpoint currently supports English only.', 400);
  }

  const bin = process.env.PIPER_BIN || 'piper';
  const model = process.env.PIPER_EN_MODEL || process.env.PIPER_MODEL;
  const config = process.env.PIPER_EN_CONFIG || process.env.PIPER_CONFIG;

  if (!model) {
    throw createHttpError('Missing PIPER_EN_MODEL or PIPER_MODEL environment variable.', 500);
  }

  return { bin, model, config };
}

function runPiper({ bin, model, config, text, outputFile }) {
  return new Promise((resolve, reject) => {
    const args = ['--model', model, '--output_file', outputFile];
    if (config) {
      args.push('--config', config);
    }

    const child = spawn(bin, args, {
      stdio: ['pipe', 'ignore', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(createHttpError(stderr.trim() || `Piper exited with code ${code}.`, 502));
    });

    child.stdin.end(`${text}\n`);
  });
}

export async function synthesizeWithPiper({ text, lang = 'en' }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw createHttpError('Missing text.', 400);
  }
  if (cleanText.length > 5000) {
    throw createHttpError('Text is too long for local TTS.', 413);
  }

  const config = getPiperConfig(lang);
  const outputFile = path.join(
    os.tmpdir(),
    `vocab-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
  );

  try {
    await runPiper({ ...config, text: cleanText, outputFile });
    const audio = await fs.readFile(outputFile);
    return {
      audio,
      contentType: 'audio/wav'
    };
  } finally {
    await fs.unlink(outputFile).catch(() => {});
  }
}
