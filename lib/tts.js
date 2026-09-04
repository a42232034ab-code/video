'use strict';

const { spawn, spawnSync } = require('child_process');

const VOICE_MAP = {
  ja: { neutral: 'ja', male: 'ja+m3', female: 'ja+f3' },
  en: { neutral: 'en-us', male: 'en-us+m3', female: 'en-us+f3' },
};

let cachedAvailable = null;

/** Returns true if the espeak-ng binary is present on this machine. */
function isAvailable() {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    const res = spawnSync('espeak-ng', ['--version'], { stdio: 'ignore' });
    cachedAvailable = res.status === 0;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

function resolveVoice(language, gender) {
  const langVoices = VOICE_MAP[language] || VOICE_MAP.ja;
  return langVoices[gender] || langVoices.neutral;
}

/**
 * Synthesizes `text` to a WAV file at `outPath` using espeak-ng.
 * Text is piped via stdin to avoid argv escaping/length issues.
 */
function synthesize(text, outPath, { language = 'ja', gender = 'neutral', rateWpm = 165 } = {}) {
  return new Promise((resolve, reject) => {
    const voice = resolveVoice(language, gender);
    const args = ['-v', voice, '-s', String(rateWpm), '-w', outPath];
    const child = spawn('espeak-ng', args);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`espeak-ng exited with code ${code}: ${stderr}`));
    });

    child.stdin.write(text, 'utf8');
    child.stdin.end();
  });
}

module.exports = { isAvailable, synthesize };
