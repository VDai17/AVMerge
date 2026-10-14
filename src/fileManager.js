'use strict';

const fs   = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'];

function getExt(filePath) {
  return path.extname(filePath).toLowerCase();
}

function validateAudioFile(filePath) {
  if (!filePath) return { valid: false, error: 'No file path provided' };

  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${path.basename(filePath)}` };
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return { valid: false, error: `Not a file: ${filePath}` };
  }

  if (stats.size === 0) {
    return { valid: false, error: `File is empty: ${path.basename(filePath)}` };
  }

  if (!SUPPORTED_EXTENSIONS.includes(getExt(filePath))) {
    return {
      valid: false,
      error: `Unsupported format "${getExt(filePath)}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    };
  }

  return { valid: true };
}

function validateAllFiles(files) {
  const errors = [];
  for (const f of files) {
    const result = validateAudioFile(f);
    if (!result.valid) errors.push(result.error);
  }
  return errors;
}

/**
 * Returns the output codec/options array for the given output path.
 */
function getOutputOptions(outputPath) {
  switch (getExt(outputPath)) {
    case '.wav':
      return ['-codec:a pcm_s16le'];
    case '.m4a':
    case '.aac':
      return ['-codec:a aac', '-b:a 192k'];
    case '.ogg':
      return ['-codec:a libvorbis', '-q:a 5'];
    case '.flac':
      return ['-codec:a flac'];
    case '.mp3':
    default:
      return ['-codec:a libmp3lame', '-q:a 2'];
  }
}

module.exports = { validateAudioFile, validateAllFiles, getOutputOptions, SUPPORTED_EXTENSIONS };
