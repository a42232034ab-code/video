'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const tts = require('./tts');
const { getWavDurationSeconds } = require('./wav');
const video = require('./video');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

for (const dir of [DATA_DIR, TMP_DIR, OUTPUT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** @type {Map<string, object>} */
const jobs = new Map();

function createJobId() {
  return crypto.randomUUID();
}

function getJob(id) {
  return jobs.get(id) || null;
}

const OUTPUT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function cleanupOldOutputs() {
  const now = Date.now();
  for (const dir of [OUTPUT_DIR, TMP_DIR]) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > OUTPUT_MAX_AGE_MS) rmrf(full);
      } catch {
        // already removed, ignore
      }
    }
  }
}

setInterval(cleanupOldOutputs, 30 * 60 * 1000).unref();

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/**
 * Starts an async video-generation job. Returns the job id immediately;
 * progress/status are tracked via getJob(id).
 */
function startJob({ lines, settings, cleanupPaths = [] }) {
  const id = createJobId();
  const workDir = path.join(TMP_DIR, id);
  fs.mkdirSync(workDir, { recursive: true });

  const job = {
    id,
    status: 'queued',
    progress: 0,
    message: 'キューに追加されました',
    error: null,
    outputPath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);

  process.nextTick(() => {
    runJob(id, workDir, lines, settings)
      .catch((err) => {
        updateJob(id, { status: 'error', message: err.message || String(err), error: err.message || String(err) });
      })
      .finally(() => {
        for (const p of cleanupPaths) {
          fs.rm(p, { force: true }, () => {});
        }
      });
  });

  return id;
}

/** Resolves the speaker config (voice/character image/screen side) for a line. */
function resolveSpeaker(line, settings) {
  if (line.speaker === 'A') return { ...settings.speakers.A, side: 'left' };
  if (line.speaker === 'B') return { ...settings.speakers.B, side: 'right' };
  return { ...settings.speakers.narration, imagePath: null, side: 'center' };
}

async function runJob(id, workDir, lines, settings) {
  updateJob(id, { status: 'processing', progress: 2, message: '準備中...' });

  const useNarration = !!settings.narration && tts.isAvailable();
  const clipPaths = [];

  const total = lines.length;
  for (let i = 0; i < total; i++) {
    const line = lines[i];
    const speaker = resolveSpeaker(line, settings);
    updateJob(id, {
      progress: 5 + Math.round((i / total) * 75),
      message: `${i + 1}/${total} 行目を生成中...`,
    });

    let audioPath = null;
    let durationSec;

    if (useNarration && line.text && line.text.trim().length > 0) {
      audioPath = path.join(workDir, `narration_${i}.wav`);
      await tts.synthesize(line.text, audioPath, {
        language: settings.language || 'ja',
        gender: speaker.gender || 'neutral',
      });
      durationSec = getWavDurationSeconds(audioPath) + video.NARRATION_TAIL_PADDING;
    } else {
      durationSec = video.estimateSilentDuration(line.text || '');
    }

    const clipPath = path.join(workDir, `line_${String(i).padStart(4, '0')}.mp4`);
    await video.renderSceneClip({
      customImagePath: line.customImagePath || null,
      backgroundImagePath: settings.backgroundPath || null,
      characterImagePath: speaker.imagePath || null,
      characterSide: speaker.side,
      audioPath,
      durationSec,
      captionText: settings.captions ? line.text : null,
      aspect: settings.aspect || '16:9',
      kenBurns: !!settings.kenBurns,
      outputPath: clipPath,
    });

    clipPaths.push(clipPath);
  }

  updateJob(id, { progress: 82, message: '動画を結合中...' });
  const concatPath = path.join(workDir, 'concatenated.mp4');
  await video.concatClips(clipPaths, concatPath, workDir);

  let finalWorkPath = concatPath;
  if (settings.bgmPath) {
    updateJob(id, { progress: 92, message: 'BGMをミックス中...' });
    const mixedPath = path.join(workDir, 'final.mp4');
    await video.mixBackgroundMusic(concatPath, settings.bgmPath, mixedPath, {
      volume: settings.bgmVolume ?? 0.15,
    });
    finalWorkPath = mixedPath;
  }

  const outputPath = path.join(OUTPUT_DIR, `${id}.mp4`);
  fs.copyFileSync(finalWorkPath, outputPath);

  updateJob(id, {
    status: 'done',
    progress: 100,
    message: '完成しました',
    outputPath,
    narrationUsed: useNarration,
  });

  rmrf(workDir);
}

module.exports = { startJob, getJob };
