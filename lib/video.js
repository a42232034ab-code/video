'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const { buildAssSubtitle } = require('./ass');

// Empirically measured (Noto Sans CJK JP, BorderStyle=1, Outline=2): a
// full-width glyph's rendered advance is ~0.69x the nominal ASS FontSize.
const CJK_CHAR_WIDTH_RATIO = 0.69;
const SUBTITLE_SAFE_WIDTH_RATIO = 0.88;

const RESOLUTIONS = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
};

const FPS = 30;
const FADE_DURATION = 0.35;
const MIN_SCENE_DURATION = 2.5;
const READING_CHARS_PER_SEC = 6; // rough Japanese reading-speed estimate
const NARRATION_TAIL_PADDING = 0.6;

const CANDIDATE_FONT_PATHS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
];

function findFontFile() {
  for (const p of CANDIDATE_FONT_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findFontsDir() {
  const file = findFontFile();
  return file ? path.dirname(file) : null;
}

/** Escapes a path for safe use inside an ffmpeg filter option string. */
function escapeFilterPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function runFfmpeg(args, { onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (onLog) onLog(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-3000)}`));
    });
  });
}

/**
 * Estimates a scene's spoken duration from its text when no narration audio
 * is generated (narration disabled or TTS unavailable).
 */
function estimateSilentDuration(text) {
  const charCount = [...text.replace(/\s+/g, '')].length;
  return Math.max(MIN_SCENE_DURATION, charCount / READING_CHARS_PER_SEC + 1);
}

/**
 * Renders one scene (image + optional narration audio + optional captions)
 * into a standalone mp4 clip with consistent codec parameters so that
 * clips can later be concatenated via stream copy.
 */
async function renderSceneClip({
  imagePath,
  audioPath, // null => silent audio
  durationSec,
  captionText, // null/empty => no captions
  aspect,
  kenBurns,
  outputPath,
}) {
  const { width, height } = RESOLUTIONS[aspect] || RESOLUTIONS['16:9'];
  const frames = Math.max(1, Math.round(durationSec * FPS));

  const filters = [];
  if (kenBurns) {
    const maxZoom = 1.15;
    const zoomStep = (maxZoom - 1) / frames;
    filters.push(
      `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
      `crop=${width * 2}:${height * 2}`,
      `zoompan=z='min(zoom+${zoomStep.toFixed(6)},${maxZoom})':d=${frames}:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS}`
    );
  } else {
    filters.push(
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${FPS}`
    );
  }

  let assPath = null;
  if (captionText && captionText.trim().length > 0) {
    const fontsDir = findFontsDir();
    assPath = `${outputPath}.ass`;
    const fontSize = Math.round(height * 0.055);
    const marginV = Math.round(height * 0.05);
    // libass has no CJK auto-wrap (no whitespace to break on), so lines are
    // pre-wrapped by character count using the font's measured advance width.
    const maxCharsPerLine = Math.max(
      8,
      Math.floor((width * SUBTITLE_SAFE_WIDTH_RATIO) / (fontSize * CJK_CHAR_WIDTH_RATIO))
    );
    fs.writeFileSync(
      assPath,
      buildAssSubtitle(captionText, durationSec, { width, height, fontSize, maxCharsPerLine, marginV }),
      'utf8'
    );
    let assFilter = `ass=${escapeFilterPath(assPath)}`;
    if (fontsDir) assFilter += `:fontsdir=${escapeFilterPath(fontsDir)}`;
    filters.push(assFilter);
  }

  const fadeOutStart = Math.max(0, durationSec - FADE_DURATION);
  filters.push(`fade=t=in:st=0:d=${FADE_DURATION}`, `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}`);

  const args = ['-y', '-loop', '1', '-i', imagePath];
  if (audioPath) {
    args.push('-i', audioPath);
  } else {
    args.push('-f', 'lavfi', '-i', `anullsrc=r=22050:cl=mono`);
  }

  args.push(
    '-t', String(durationSec),
    '-vf', filters.join(','),
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-shortest',
    outputPath
  );

  await runFfmpeg(args);
  if (assPath) fs.unlinkSync(assPath);
}

async function concatClips(clipPaths, outputPath, workDir) {
  const listPath = path.join(workDir, 'concat_list.txt');
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listContent, 'utf8');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
}

async function mixBackgroundMusic(videoPath, bgmPath, outputPath, { volume = 0.15 } = {}) {
  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-stream_loop', '-1',
    '-i', bgmPath,
    '-filter_complex',
    `[1:a]volume=${volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ]);
}

module.exports = {
  RESOLUTIONS,
  FPS,
  findFontFile,
  estimateSilentDuration,
  renderSceneClip,
  concatClips,
  mixBackgroundMusic,
  NARRATION_TAIL_PADDING,
};
