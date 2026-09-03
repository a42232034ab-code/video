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
const MAX_SCENES = 40;
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
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_SCENES + 2 },
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    aspects: Object.keys(RESOLUTIONS),
    narrationAvailable: tts.isAvailable(),
    captionsAvailable: !!findFontFile(),
    maxScenes: MAX_SCENES,
  });
});

app.post('/api/generate', upload.any(), (req, res) => {
  const uploadedPaths = (req.files || []).map((f) => f.path);

  try {
    let scenes;
    let settings;
    try {
      scenes = JSON.parse(req.body.scenes || '[]');
      settings = JSON.parse(req.body.settings || '{}');
    } catch {
      throw badRequest('scenes / settings の JSON が不正です');
    }

    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw badRequest('少なくとも1つのシーンが必要です');
    }
    if (scenes.length > MAX_SCENES) {
      throw badRequest(`シーン数は最大 ${MAX_SCENES} 件までです`);
    }
    if (!RESOLUTIONS[settings.aspect]) {
      settings.aspect = '16:9';
    }

    const filesByField = new Map((req.files || []).map((f) => [f.fieldname, f]));

    const resolvedScenes = scenes.map((scene, i) => {
      const file = filesByField.get(`image_${i}`);
      if (!file) throw badRequest(`シーン ${i + 1} の画像がアップロードされていません`);
      return {
        text: typeof scene.text === 'string' ? scene.text.slice(0, 2000) : '',
        imagePath: file.path,
      };
    });

    const bgmFile = filesByField.get('bgm');
    const resolvedSettings = {
      narration: !!settings.narration,
      gender: ['male', 'female', 'neutral'].includes(settings.gender) ? settings.gender : 'neutral',
      language: ['ja', 'en'].includes(settings.language) ? settings.language : 'ja',
      captions: settings.captions !== false,
      aspect: settings.aspect,
      kenBurns: !!settings.kenBurns,
      bgmPath: bgmFile ? bgmFile.path : null,
      bgmVolume: typeof settings.bgmVolume === 'number' ? Math.min(1, Math.max(0, settings.bgmVolume)) : 0.15,
    };

    const jobId = jobsLib.startJob({ scenes: resolvedScenes, settings: resolvedSettings, cleanupPaths: uploadedPaths });
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

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

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
