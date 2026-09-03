'use strict';

const { wrapText } = require('./text-wrap');

function formatAssTimestamp(seconds) {
  const cs = Math.round(seconds * 100); // centiseconds
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(c)}`;
}

/** Escapes text for safe use as ASS Dialogue text (no stray override tags). */
function escapeAssText(text) {
  return text.replace(/\\/g, '∖').replace(/\{/g, '(').replace(/\}/g, ')');
}

/**
 * Builds a self-contained .ass subtitle file with an explicit PlayResX/Y
 * matching the target video canvas. This is important: libass scales
 * FontSize relative to PlayResY (384x288 by default when unset), so
 * without an explicit PlayRes matching the real canvas, the same nominal
 * FontSize renders at wildly different pixel sizes depending on video
 * resolution.
 */
function buildAssSubtitle(text, durationSec, { width, height, fontSize, maxCharsPerLine, marginV = 60 }) {
  const wrapped = wrapText(text, maxCharsPerLine).map(escapeAssText).join('\\N');
  const start = formatAssTimestamp(0);
  const end = formatAssTimestamp(durationSec);

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK JP,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${start},${end},Default,,0,0,0,,${wrapped}
`;
}

module.exports = { buildAssSubtitle, escapeAssText };
