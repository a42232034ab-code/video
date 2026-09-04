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
const MIN_SCENE_DURATION = 2.0;
const READING_CHARS_PER_SEC = 6; // rough Japanese reading-speed estimate
const NARRATION_TAIL_PADDING = 0.5;

// "Yukkuri"-style dialogue layout: a shared background with a character
// sprite overlaid bottom-left/bottom-right depending on who's speaking.
const CHARACTER_HEIGHT_FRACTION = 0.82;
const CHARACTER_SIDE_MARGIN_FRACTION = 0.02;
const FALLBACK_BG_COLOR = '0x2b2f3a';

// Long-form videos can mean hundreds of short clips to render — trade a
// little quality/size for much faster per-clip encodes.
const VIDEO_PRESET = 'veryfast';
const VIDEO_CRF = 23;

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-3000)}`));
    });
  });
}

/**
 * Estimates a line's spoken duration from its text when no narration audio
 * is generated (narration disabled or TTS unavailable).
 */
function estimateSilentDuration(text) {
  const charCount = [...text.replace(/\s+/g, '')].length;
  return Math.max(MIN_SCENE_DURATION, charCount / READING_CHARS_PER_SEC + 1);
}

/** Builds the scale(+optional Ken Burns zoom) chain that fills the canvas. */
function buildBaseChain(inputRef, outLabel, width, height, kenBurns, frames) {
  if (kenBurns) {
    const maxZoom = 1.15;
    const zoomStep = (maxZoom - 1) / frames;
    return (
      `[${inputRef}]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,` +
      `crop=${width * 2}:${height * 2},` +
      `zoompan=z='min(zoom+${zoomStep.toFixed(6)},${maxZoom})':d=${frames}:` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS}[${outLabel}]`
    );
  }
  return (
    `[${inputRef}]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},fps=${FPS}[${outLabel}]`
  );
}

/**
 * Renders one line (dialogue cue) into a standalone mp4 clip with
 * consistent codec parameters so that clips can later be concatenated via
 * stream copy.
 *
 * Visual composition, in priority order:
 *  1. customImagePath  — a full-frame image dedicated to this line only.
 *  2. backgroundImagePath (+ optional characterImagePath overlaid at the
 *     bottom, positioned left/right/center per `characterSide`) — the
 *     shared "yukkuri"-style dialogue look, reused across many lines.
 *  3. A flat fallback color, if neither of the above is provided, so a
 *     line never fails to render just because no image was supplied.
 */
async function renderSceneClip({
  customImagePath,
  backgroundImagePath,
  characterImagePath,
  characterSide = 'center',
  audioPath, // null => silent audio
  durationSec,
  captionText, // null/empty => no captions
  aspect,
  kenBurns,
  outputPath,
}) {
  const { width, height } = RESOLUTIONS[aspect] || RESOLUTIONS['16:9'];
  const frames = Math.max(1, Math.round(durationSec * FPS));

  const inputs = [];
  const pushInput = (argsArr) => { inputs.push(argsArr); return inputs.length - 1; };
  const addImageInput = (p) => pushInput(['-loop', '1', '-i', p]);

  const filterParts = [];
  let videoLabel;

  if (customImagePath) {
    const idx = addImageInput(customImagePath);
    filterParts.push(buildBaseChain(`${idx}:v`, 'base', width, height, kenBurns, frames));
    videoLabel = 'base';
  } else {
    let bgLabel;
    if (backgroundImagePath) {
      const idx = addImageInput(backgroundImagePath);
      filterParts.push(buildBaseChain(`${idx}:v`, 'bg', width, height, kenBurns, frames));
      bgLabel = 'bg';
    } else {
      const idx = pushInput(['-f', 'lavfi', '-i', `color=c=${FALLBACK_BG_COLOR}:s=${width}x${height}`]);
      filterParts.push(`[${idx}:v]format=yuv420p,fps=${FPS}[bg]`);
      bgLabel = 'bg';
    }
    videoLabel = bgLabel;

    if (characterImagePath) {
      const idx = addImageInput(characterImagePath);
      const targetH = Math.round(height * CHARACTER_HEIGHT_FRACTION);
      const evenH = targetH - (targetH % 2);
      filterParts.push(`[${idx}:v]scale=-2:${evenH}:force_original_aspect_ratio=decrease,format=rgba[char]`);
      const marginPx = Math.round(width * CHARACTER_SIDE_MARGIN_FRACTION);
      let xExpr = `(${width}-w)/2`;
      if (characterSide === 'left') xExpr = String(marginPx);
      else if (characterSide === 'right') xExpr = `${width}-w-${marginPx}`;
      filterParts.push(`[${bgLabel}][char]overlay=x=${xExpr}:y=${height}-h[comp]`);
      videoLabel = 'comp';
    }
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
    let assFilter = `[${videoLabel}]ass=${escapeFilterPath(assPath)}`;
    if (fontsDir) assFilter += `:fontsdir=${escapeFilterPath(fontsDir)}`;
    assFilter += '[sub]';
    filterParts.push(assFilter);
    videoLabel = 'sub';
  }

  const fadeOutStart = Math.max(0, durationSec - FADE_DURATION);
  filterParts.push(
    `[${videoLabel}]fade=t=in:st=0:d=${FADE_DURATION},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}[outv]`
  );

  const audioIdx = audioPath
    ? pushInput(['-i', audioPath])
    : pushInput(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono']);

  const args = [
    '-y',
    ...inputs.flat(),
    '-t', String(durationSec),
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-map', `${audioIdx}:a`,
    '-c:v', 'libx264',
    '-preset', VIDEO_PRESET,
    '-crf', String(VIDEO_CRF),
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-shortest',
    outputPath,
  ];

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
