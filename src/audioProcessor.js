'use strict';

const ffmpeg      = require('fluent-ffmpeg');
const ffmpegPath  = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const fs          = require('fs');
const os          = require('os');
const path        = require('path');

const { getOutputOptions } = require('./fileManager');

// Point fluent-ffmpeg at the bundled binaries so no system install is needed
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/** Verify that the bundled FFmpeg binary is usable. */
function checkFFmpeg() {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        resolve({ available: false, error: err.message });
      } else {
        resolve({ available: true });
      }
    });
  });
}

/** Return audio metadata for a single file. */
function getAudioInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`Cannot read "${path.basename(filePath)}": ${err.message}`));
        return;
      }
      const stream = metadata.streams.find((s) => s.codec_type === 'audio');
      if (!stream) {
        reject(new Error(`No audio stream found in "${path.basename(filePath)}"`));
        return;
      }
      resolve({
        duration:   parseFloat(metadata.format.duration) || 0,
        format:     metadata.format.format_long_name || metadata.format.format_name,
        codec:      stream.codec_name,
        sampleRate: parseInt(stream.sample_rate, 10) || 0,
        channels:   stream.channels || 0,
        bitrate:    parseInt(metadata.format.bit_rate, 10) || 0,
        size:       parseInt(metadata.format.size, 10) || 0,
      });
    });
  });
}

/**
 * Merge an ordered list of audio files into a single output file.
 *
 * Uses the FFmpeg concat demuxer so it scales to any number of inputs
 * without hitting command-line length limits.
 *
 * @param {string[]}  files       - Absolute paths in play order
 * @param {string}    outputPath  - Absolute path of the output file
 * @param {Function}  onProgress  - Called with { percent, timemark }
 */
function mergeAudioFiles(files, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) {
      return reject(new Error('No files provided for merge.'));
    }

    // Write a temporary concat demuxer list file
    const listPath = path.join(os.tmpdir(), `avmerge_${Date.now()}.txt`);
    try {
      const content = files
        .map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(listPath, content, 'utf8');
    } catch (e) {
      return reject(new Error(`Failed to write temp file list: ${e.message}`));
    }

    const cleanup = () => {
      try { fs.unlinkSync(listPath); } catch (_) {}
    };

    const codecOpts = getOutputOptions(outputPath);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-ar 44100', '-ac 2', ...codecOpts])
      .output(outputPath)
      .on('start', (cmd) => {
        // Uncomment to debug: console.log('FFmpeg command:', cmd);
      })
      .on('progress', (p) => {
        if (onProgress) {
          onProgress({
            percent:  Math.min(Math.max(Math.round(p.percent || 0), 0), 99),
            timemark: p.timemark || '00:00:00',
          });
        }
      })
      .on('end', () => {
        cleanup();
        if (onProgress) onProgress({ percent: 100, timemark: null });
        resolve();
      })
      .on('error', (err) => {
        cleanup();
        // Try to remove a partial output file
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
        reject(new Error(err.message));
      })
      .run();
  });
}

const GIF_EXTENSIONS  = new Set(['.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);

/**
 * Loop a background visual (GIF or silent video) for the duration of the
 * merged audio, then combine them into a single MP4 with audio.
 *
 * - GIF  → -ignore_loop 0   (respects frame delays, loops the palette animation)
 * - Video → -stream_loop -1  (byte-level loop of the container)
 *
 * Audio from the background file is always ignored; only the video stream
 * from input 0 and the audio from the concat list (input 1) are used.
 *
 * @param {string[]}  files          - Ordered audio paths (concat list)
 * @param {string}    backgroundPath - Path to GIF or silent video file
 * @param {string}    outputPath     - Output .mp4 path
 * @param {Function}  onProgress
 */
function mergeWithBackground(files, backgroundPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) {
      return reject(new Error('No audio files provided for merge.'));
    }

    const ext = path.extname(backgroundPath).toLowerCase();
    const isGif = GIF_EXTENSIONS.has(ext);
    const isVideo = VIDEO_EXTENSIONS.has(ext);
    if (!isGif && !isVideo) {
      return reject(new Error(`Unsupported background format: ${ext}`));
    }

    const listPath = path.join(os.tmpdir(), `avmerge_${Date.now()}.txt`);
    try {
      const content = files
        .map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(listPath, content, 'utf8');
    } catch (e) {
      return reject(new Error(`Failed to write temp file list: ${e.message}`));
    }

    const cleanup = () => { try { fs.unlinkSync(listPath); } catch (_) {} };

    const cmd = ffmpeg();

    // Input 0: background visual — looped indefinitely
    cmd.input(backgroundPath);
    if (isGif) {
      // -ignore_loop 0 forces FFmpeg to loop past the GIF's own loop count
      cmd.inputOptions(['-ignore_loop 0']);
    } else {
      cmd.inputOptions(['-stream_loop -1']);
    }

    // Input 1: audio via concat demuxer
    cmd
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0']);

    // Video filter: normalise dimensions (H.264 requires even width/height).
    // For GIF we also cap fps at 15 — GIFs are typically 10-15 fps and letting
    // FFmpeg upsample to 25/30 fps just duplicates frames and wastes CPU.
    const vf = isGif
      ? 'fps=15,scale=trunc(iw/2)*2:trunc(ih/2)*2'
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

    cmd
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        `-vf ${vf}`,
        '-c:v libx264',
        '-preset ultrafast',   // 4-6× faster than medium; fine for a looping background
        '-crf 28',             // slightly looser quality — imperceptible on a background loop
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        '-shortest',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('progress', (p) => {
        if (onProgress) {
          onProgress({
            percent:  Math.min(Math.max(Math.round(p.percent || 0), 0), 99),
            timemark: p.timemark || '00:00:00',
          });
        }
      })
      .on('end', () => {
        cleanup();
        if (onProgress) onProgress({ percent: 100, timemark: null });
        resolve();
      })
      .on('error', (err) => {
        cleanup();
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
        reject(new Error(err.message));
      })
      .run();
  });
}

module.exports = { checkFFmpeg, getAudioInfo, mergeAudioFiles, mergeWithBackground };
