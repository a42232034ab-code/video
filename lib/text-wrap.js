'use strict';

/**
 * Wraps text into multiple lines by character count. CJK text has no spaces,
 * so libass's built-in wrapping can't be relied on — we wrap manually here.
 * Existing newlines in the source text are preserved as hard breaks.
 */
function wrapText(text, maxCharsPerLine) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > maxCharsPerLine) {
      lines.push(remaining.slice(0, maxCharsPerLine));
      remaining = remaining.slice(maxCharsPerLine);
    }
    lines.push(remaining);
  }
  return lines.filter((l) => l.length > 0);
}

module.exports = { wrapText };
