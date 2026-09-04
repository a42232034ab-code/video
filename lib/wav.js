'use strict';

const fs = require('fs');

/**
 * Reads the duration (in seconds) of a PCM WAV file by parsing its RIFF header.
 */
function getWavDurationSeconds(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a valid WAV file: ${filePath}`);
  }

  let offset = 12;
  let byteRate = null;
  let dataSize = null;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      byteRate = buf.readUInt32LE(bodyStart + 8);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
    }

    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize) {
    throw new Error(`Could not determine WAV duration for: ${filePath}`);
  }

  return dataSize / byteRate;
}

module.exports = { getWavDurationSeconds };
