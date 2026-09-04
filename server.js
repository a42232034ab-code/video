'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

const jobsLib = require('./lib/jobs');
const tts = require('./lib/tts');
const { RESOLUTIONS, findFontFile } = require('./lib/video');

const PORT = process.env.PORT || 3000;
const MAX_LINES = 300;
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_LINES + 5 },
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    aspects: Object.keys(RESOLUTIONS),
    narrationAvailable: tts.isAvailable(),
    captionsAvailable: !!findFontFile(),
    maxLines: MAX_LINES,
  });
});

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function resolveGender(value) {
  return ['male', 'female', 'neutral'].includes(value) ? value : 'neutral';
}

app.post('/api/generate', upload.any(), (req, res) => {
  const uploadedPaths = (req.files || []).map((f) => f.path);

  try {
    let lines;
    let settingsInput;
    try {
      lines = JSON.parse(req.body.lines || '[]');
      settingsInput = JSON.parse(req.body.settings || '{}');
    } catch {
      throw badRequest('lines / settings の JSON が不正です');
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      throw badRequest('少なくとも1行の台本が必要です');
    }
    if (lines.length > MAX_LINES) {
      throw badRequest(`行数は最大 ${MAX_LINES} 件までです`);
    }
    if (!RESOLUTIONS[settingsInput.aspect]) {
      settingsInput.aspect = '16:9';
    }

    const filesByField = new Map((req.files || []).map((f) => [f.fieldname, f]));

    const resolvedLines = lines.map((line, i) => {
      const speaker = line.speaker === 'A' || line.speaker === 'B' ? line.speaker : null;
      const overrideFile = filesByField.get(`line_${i}_image`);
      return {
        speaker,
        text: typeof line.text === 'string' ? line.text.slice(0, 2000) : '',
        customImagePath: overrideFile ? overrideFile.path : null,
      };
    });

    const backgroundFile = filesByField.get('background');
    const speakerAImage = filesByField.get('speakerA_image');
    const speakerBImage = filesByField.get('speakerB_image');
    const bgmFile = filesByField.get('bgm');

    const speakersInput = settingsInput.speakers || {};

    const resolvedSettings = {
      narration: !!settingsInput.narration,
      language: ['ja', 'en'].includes(settingsInput.language) ? settingsInput.language : 'ja',
      captions: settingsInput.captions !== false,
      aspect: settingsInput.aspect,
      kenBurns: !!settingsInput.kenBurns,
      backgroundPath: backgroundFile ? backgroundFile.path : null,
      speakers: {
        A: {
          name: typeof speakersInput.A?.name === 'string' ? speakersInput.A.name.slice(0, 40) : '話者A',
          gender: resolveGender(speakersInput.A?.gender),
          imagePath: speakerAImage ? speakerAImage.path : null,
        },
        B: {
          name: typeof speakersInput.B?.name === 'string' ? speakersInput.B.name.slice(0, 40) : '話者B',
          gender: resolveGender(speakersInput.B?.gender),
          imagePath: speakerBImage ? speakerBImage.path : null,
        },
        narration: {
          gender: resolveGender(speakersInput.narration?.gender),
        },
      },
      bgmPath: bgmFile ? bgmFile.path : null,
      bgmVolume: typeof settingsInput.bgmVolume === 'number' ? Math.min(1, Math.max(0, settingsInput.bgmVolume)) : 0.15,
    };

    const jobId = jobsLib.startJob({ lines: resolvedLines, settings: resolvedSettings, cleanupPaths: uploadedPaths });
    res.json({ jobId });
  } catch (err) {
    for (const p of uploadedPaths) fs.rm(p, { force: true }, () => {});
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobsLib.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ジョブが見つかりません' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    videoUrl: job.status === 'done' ? `/api/jobs/${job.id}/video` : null,
  });
});

app.get('/api/jobs/:id/video', (req, res) => {
  const job = jobsLib.getJob(req.params.id);
  if (!job || job.status !== 'done' || !job.outputPath) {
    return res.status(404).json({ error: '動画がまだ準備できていません' });
  }
  if (req.query.download) {
    res.download(job.outputPath, `${job.id}.mp4`);
  } else {
    res.sendFile(job.outputPath);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `アップロードエラー: ${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: 'サーバーエラーが発生しました' });
});

app.listen(PORT, () => {
  console.log(`Script-to-video server listening on http://localhost:${PORT}`);
  console.log(`Narration (espeak-ng) available: ${tts.isAvailable()}`);
});
