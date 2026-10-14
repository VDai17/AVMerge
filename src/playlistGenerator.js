'use strict';

/**
 * Fisher-Yates in-place shuffle
 */
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Build the final ordered playlist.
 * Intro plays once at the start, then content files are shuffled and repeated N times.
 *
 * @param {string|null} introFile  - Absolute path to intro file, or null
 * @param {string[]}    contentFiles - Array of absolute paths to content files
 * @param {number}      repeatCount  - How many times to play the full content list
 * @returns {string[]} Ordered list of absolute file paths
 */
function generatePlaylist(introFile, contentFiles, repeatCount) {
  if (repeatCount < 1 || !Number.isInteger(repeatCount)) {
    throw new Error('Repeat count must be a positive integer');
  }

  const playlist = [];

  if (introFile) {
    playlist.push(introFile);
  }

  for (let i = 0; i < repeatCount; i++) {
    const shuffled = shuffleArray(contentFiles);
    playlist.push(...shuffled);
  }

  return playlist;
}

module.exports = { shuffleArray, generatePlaylist };
