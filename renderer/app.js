'use strict';

/* ════════════════════════════════════════════════════════════════
   State
   ════════════════════════════════════════════════════════════════ */
const state = {
  intro:               null,   // { path, name, duration }
  tracks:              [],     // [{ id, path, name, duration }, ...]
  repeatCount:         1,
  outputPath:          '',
  background:          null,   // { path, name, ext, isGif }
  processing:          false,
  playlist:            [],
  totalOutputDuration: 0,      // seconds — pre-calculated before merge
  mergeStartTime:      null,   // Date.now() when merge began
};

let trackIdCounter = 0;

const GIF_EXTS   = new Set(['.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);

/* ════════════════════════════════════════════════════════════════
   Audio preview player
   ════════════════════════════════════════════════════════════════ */
const audio     = new Audio();
let   playingId = null;   // 'intro' | track id | null
audio.addEventListener('ended', () => stopPreview());

/* ════════════════════════════════════════════════════════════════
   Playlist helpers
   ════════════════════════════════════════════════════════════════ */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPlaylist(intro, tracks, repeat) {
  const list = [];
  if (intro) list.push({ ...intro, isIntro: true });
  for (let i = 0; i < repeat; i++) {
    shuffleArray(tracks).forEach((t) => list.push({ ...t, isIntro: false }));
  }
  return list;
}

/* ════════════════════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════════════════════ */
function fmtDuration(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "HH:MM:SS.ss" or "MM:SS.ss" → seconds */
function parseTimemark(tm) {
  if (!tm) return 0;
  const parts = tm.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600
         + parseInt(parts[1], 10) * 60
         + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

/** Total seconds the output file will be (audio drives the duration). */
function calculateTotalDuration() {
  let total = 0;
  if (state.intro) total += state.intro.duration;
  const trackSum = state.tracks.reduce((s, t) => s + t.duration, 0);
  total += trackSum * state.repeatCount;
  return total;
}

/** Format seconds as "Xh Ym Zs" for ETA display. */
function fmtEta(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}g ${m}p ${s}s`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
}

function el(id) { return document.getElementById(id); }

function fileExt(p) {
  const m = p.match(/\.([^.\\\/]+)$/);
  return m ? '.' + m[1].toLowerCase() : '';
}

/* ════════════════════════════════════════════════════════════════
   DOM refs
   ════════════════════════════════════════════════════════════════ */
const dom = {
  ffmpegStatus:    el('ffmpeg-status'),
  introEmpty:      el('intro-empty'),
  introFile:       el('intro-file'),
  introName:       el('intro-name'),
  introDuration:   el('intro-duration'),
  introPreviewBtn: el('intro-preview-btn'),
  introRemoveBtn:  el('intro-remove-btn'),
  browseIntro:     el('browse-intro'),
  addTracks:       el('add-tracks'),
  tracksList:      el('tracks-list'),
  tracksEmpty:     el('tracks-empty'),
  repeatCount:     el('repeat-count'),
  // background visual
  bgEmpty:         el('bg-empty'),
  bgFile:          el('bg-file'),
  bgPreviewGif:    el('bg-preview-gif'),
  bgPreviewVideo:  el('bg-preview-video'),
  bgName:          el('bg-name'),
  bgTypeTag:       el('bg-type-tag'),
  bgRemoveBtn:     el('bg-remove-btn'),
  browseBg:        el('browse-bg'),
  // output / settings
  outputHint:      el('output-hint'),
  outputDisplay:   el('output-display'),
  browseOutput:    el('browse-output'),
  playlistCard:    el('playlist-card'),
  playlistPreview: el('playlist-preview'),
  reshuffleBtn:    el('reshuffle-btn'),
  // action card
  outputSummary:   el('output-summary'),
  summaryDuration: el('summary-duration'),
  summaryMode:     el('summary-mode'),
  summaryHint:     el('summary-hint'),
  mergeBtn:        el('merge-btn'),
  progressSection: el('progress-section'),
  progressBar:     el('progress-bar'),
  progressPercent: el('progress-percent'),
  progressTime:    el('progress-time'),
  progressEta:     el('progress-eta'),
  statusMsg:       el('status-msg'),
};

/* ════════════════════════════════════════════════════════════════
   Init
   ════════════════════════════════════════════════════════════════ */
async function init() {
  bindEvents();

  const result = await window.api.checkFFmpeg();
  if (result.available) {
    dom.ffmpegStatus.textContent = 'FFmpeg: OK';
    dom.ffmpegStatus.className   = 'status-badge status-ok';
  } else {
    dom.ffmpegStatus.textContent = 'FFmpeg: Not Found';
    dom.ffmpegStatus.className   = 'status-badge status-error';
    dom.ffmpegStatus.title       = result.error || '';
    showStatus('FFmpeg không tìm thấy. Vui lòng cài đặt FFmpeg.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   Event bindings
   ════════════════════════════════════════════════════════════════ */
function bindEvents() {
  dom.browseIntro.addEventListener('click', selectIntroFile);
  dom.introPreviewBtn.addEventListener('click', () => togglePreview('intro', state.intro?.path));
  dom.introRemoveBtn.addEventListener('click', removeIntro);

  dom.addTracks.addEventListener('click', addContentTracks);

  dom.repeatCount.addEventListener('input', () => {
    const v = parseInt(dom.repeatCount.value, 10);
    state.repeatCount = isNaN(v) || v < 1 ? 1 : Math.min(v, 999);
    updatePlaylistPreview();
    updateOutputSummary();
    updateMergeButton();
  });

  dom.browseBg.addEventListener('click', selectBackground);
  dom.bgRemoveBtn.addEventListener('click', removeBackground);

  dom.browseOutput.addEventListener('click', selectOutputFile);
  dom.reshuffleBtn.addEventListener('click', updatePlaylistPreview);
  dom.mergeBtn.addEventListener('click', startMerge);

  window.api.onMergeProgress((data) => {
    const { percent, timemark } = data;

    dom.progressBar.style.width     = `${percent}%`;
    dom.progressPercent.textContent = `${percent}%`;

    if (!timemark) return;

    const processedSec = parseTimemark(timemark);
    const totalSec     = state.totalOutputDuration;

    // "processed / total"
    dom.progressTime.textContent = totalSec > 0
      ? `${fmtDuration(processedSec)} / ${fmtDuration(totalSec)}`
      : fmtDuration(processedSec);

    // ETA — only reliable after 2 seconds of real data
    if (state.mergeStartTime && processedSec > 2 && totalSec > 0) {
      const elapsedSec = (Date.now() - state.mergeStartTime) / 1000;
      const speed      = processedSec / elapsedSec;           // e.g. 3.0 = 3× realtime
      const remainSec  = Math.max(0, totalSec - processedSec);
      const etaSec     = remainSec / speed;
      const speedLabel = speed.toFixed(1);

      dom.progressEta.textContent = etaSec > 1
        ? `~${fmtEta(etaSec)} còn lại  (${speedLabel}×)`
        : 'Sắp xong...';
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   Intro file
   ════════════════════════════════════════════════════════════════ */
async function selectIntroFile() {
  const paths = await window.api.openAudioFiles({ multiple: false, title: 'Select Intro Audio' });
  if (!paths || paths.length === 0) return;

  const filePath = paths[0];
  const info     = await window.api.getAudioInfo(filePath);

  state.intro = {
    path:     filePath,
    name:     filePath.split(/[\\/]/).pop(),
    duration: info.success ? info.duration : 0,
  };

  renderIntro();
  updatePlaylistPreview();
  updateOutputSummary();
  updateMergeButton();
}

function removeIntro() {
  if (playingId === 'intro') stopPreview();
  state.intro = null;
  renderIntro();
  updatePlaylistPreview();
  updateOutputSummary();
  updateMergeButton();
}

function renderIntro() {
  if (state.intro) {
    dom.introEmpty.classList.add('hidden');
    dom.introFile.classList.remove('hidden');
    dom.introName.textContent     = state.intro.name;
    dom.introDuration.textContent = fmtDuration(state.intro.duration);
  } else {
    dom.introEmpty.classList.remove('hidden');
    dom.introFile.classList.add('hidden');
    dom.introPreviewBtn.classList.remove('playing');
    dom.introPreviewBtn.innerHTML = '&#9654;';
  }
}

/* ════════════════════════════════════════════════════════════════
   Content tracks
   ════════════════════════════════════════════════════════════════ */
async function addContentTracks() {
  const paths = await window.api.openAudioFiles({ multiple: true, title: 'Add Content Tracks' });
  if (!paths || paths.length === 0) return;

  const newTracks = await Promise.all(
    paths.map(async (p) => {
      const info = await window.api.getAudioInfo(p);
      return {
        id:       ++trackIdCounter,
        path:     p,
        name:     p.split(/[\\/]/).pop(),
        duration: info.success ? info.duration : 0,
      };
    })
  );

  state.tracks.push(...newTracks);
  renderTracksList();
  updatePlaylistPreview();
  updateOutputSummary();
  updateMergeButton();
}

function removeTrack(id) {
  if (playingId === id) stopPreview();
  state.tracks = state.tracks.filter((t) => t.id !== id);
  renderTracksList();
  updatePlaylistPreview();
  updateOutputSummary();
  updateMergeButton();
}

function renderTracksList() {
  dom.tracksList.querySelectorAll('.track-item').forEach((n) => n.remove());

  if (state.tracks.length === 0) {
    dom.tracksEmpty.classList.remove('hidden');
    return;
  }
  dom.tracksEmpty.classList.add('hidden');

  state.tracks.forEach((track, idx) => {
    const item      = document.createElement('div');
    item.className  = 'track-item';
    item.dataset.id = track.id;
    const isPlaying = playingId === track.id;

    item.innerHTML = `
      <span class="track-index">${idx + 1}</span>
      <div class="file-info" style="flex:1;min-width:0">
        <span class="file-name" title="${esc(track.path)}">${esc(track.name)}</span>
        <span class="file-duration">${fmtDuration(track.duration)}</span>
      </div>
      <div class="file-actions">
        <button class="btn btn-icon preview-btn ${isPlaying ? 'playing' : ''}"
                title="${isPlaying ? 'Stop' : 'Preview'}"
                data-id="${track.id}" data-path="${esc(track.path)}">
          ${isPlaying ? '&#9632;' : '&#9654;'}
        </button>
        <button class="btn btn-icon btn-danger remove-btn"
                title="Remove" data-id="${track.id}">&#10005;</button>
      </div>`;

    item.querySelector('.preview-btn').addEventListener('click', (e) => {
      togglePreview(parseInt(e.currentTarget.dataset.id, 10), e.currentTarget.dataset.path);
    });
    item.querySelector('.remove-btn').addEventListener('click', (e) => {
      removeTrack(parseInt(e.currentTarget.dataset.id, 10));
    });

    dom.tracksList.appendChild(item);
  });
}

/* ════════════════════════════════════════════════════════════════
   Audio preview
   ════════════════════════════════════════════════════════════════ */
function togglePreview(id, filePath) {
  if (playingId === id) { stopPreview(); return; }
  if (playingId !== null) stopPreview();

  playingId         = id;
  audio.src         = window.api.toFileUrl(filePath);
  audio.currentTime = 0;
  audio.play().catch(() => stopPreview());
  updatePreviewButtons();
}

function stopPreview() {
  audio.pause();
  audio.src = '';
  playingId = null;
  updatePreviewButtons();
}

function updatePreviewButtons() {
  const introActive = playingId === 'intro';
  dom.introPreviewBtn.classList.toggle('playing', introActive);
  dom.introPreviewBtn.innerHTML = introActive ? '&#9632;' : '&#9654;';

  dom.tracksList.querySelectorAll('.preview-btn').forEach((btn) => {
    const active = playingId === parseInt(btn.dataset.id, 10);
    btn.classList.toggle('playing', active);
    btn.innerHTML = active ? '&#9632;' : '&#9654;';
    btn.title     = active ? 'Stop' : 'Preview';
  });
}

/* ════════════════════════════════════════════════════════════════
   Background visual (GIF or silent video)
   ════════════════════════════════════════════════════════════════ */
async function selectBackground() {
  const filePath = await window.api.openBackgroundFile();
  if (!filePath) return;

  const ext   = fileExt(filePath);
  const isGif = GIF_EXTS.has(ext);
  const isVid = VIDEO_EXTS.has(ext);

  if (!isGif && !isVid) {
    showStatus(`Định dạng không hỗ trợ: ${ext}`, 'error');
    return;
  }

  state.background = {
    path:  filePath,
    name:  filePath.split(/[\\/]/).pop(),
    ext,
    isGif,
  };

  renderBackground();
  // Reset output path since mode changed (audio → video)
  state.outputPath = '';
  dom.outputDisplay.textContent = 'Not set';
  dom.outputDisplay.classList.remove('is-set');
  updateOutputHint();
  updateOutputSummary();
  updateMergeButton();
}

function removeBackground() {
  dom.bgPreviewVideo.pause();
  dom.bgPreviewVideo.src = '';

  state.background = null;
  renderBackground();
  state.outputPath = '';
  dom.outputDisplay.textContent = 'Not set';
  dom.outputDisplay.classList.remove('is-set');
  updateOutputHint();
  updateOutputSummary();
  updateMergeButton();
}

function renderBackground() {
  if (!state.background) {
    dom.bgEmpty.classList.remove('hidden');
    dom.bgFile.classList.add('hidden');
    dom.bgPreviewGif.classList.add('hidden');
    dom.bgPreviewGif.src = '';
    dom.bgPreviewVideo.classList.add('hidden');
    dom.bgPreviewVideo.src = '';
    return;
  }

  dom.bgEmpty.classList.add('hidden');
  dom.bgFile.classList.remove('hidden');
  dom.bgName.textContent = state.background.name;

  const fileUrl = window.api.toFileUrl(state.background.path);

  if (state.background.isGif) {
    dom.bgPreviewGif.src = fileUrl;
    dom.bgPreviewGif.classList.remove('hidden');
    dom.bgPreviewVideo.classList.add('hidden');
    dom.bgPreviewVideo.src = '';
    dom.bgTypeTag.textContent = 'GIF';
    dom.bgTypeTag.className   = 'bg-type-tag tag-gif';
  } else {
    dom.bgPreviewVideo.src = fileUrl;
    dom.bgPreviewVideo.load();
    dom.bgPreviewVideo.classList.remove('hidden');
    dom.bgPreviewGif.classList.add('hidden');
    dom.bgPreviewGif.src = '';
    dom.bgTypeTag.textContent = 'VIDEO';
    dom.bgTypeTag.className   = 'bg-type-tag tag-video';
  }
}

function updateOutputHint() {
  if (dom.outputHint) {
    dom.outputHint.textContent = state.background
      ? 'Where to save the merged video (MP4)'
      : 'Where to save the merged audio';
  }
}

/* ════════════════════════════════════════════════════════════════
   Output file
   ════════════════════════════════════════════════════════════════ */
async function selectOutputFile() {
  const videoMode   = Boolean(state.background);
  const defaultName = videoMode ? 'merged_video.mp4' : 'merged_audio.mp3';

  const filePath = await window.api.saveOutputFile({ defaultName, videoMode });
  if (!filePath) return;

  state.outputPath = filePath;
  dom.outputDisplay.textContent = filePath.split(/[\\/]/).pop();
  dom.outputDisplay.title       = filePath;
  dom.outputDisplay.classList.add('is-set');
  updateMergeButton();
}

/* ════════════════════════════════════════════════════════════════
   Playlist preview
   ════════════════════════════════════════════════════════════════ */
function updatePlaylistPreview() {
  const hasContent = state.tracks.length > 0 || state.intro;
  if (!hasContent) {
    dom.playlistCard.classList.add('hidden');
    state.playlist = [];
    return;
  }

  const list = buildPlaylist(state.intro, state.tracks, state.repeatCount);
  state.playlist = list.map((item) => item.path);

  dom.playlistPreview.innerHTML = '';
  list.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `
      ${item.isIntro ? '<span class="playlist-intro-tag">INTRO</span>' : ''}
      <span>${esc(item.name)}</span>
      <span class="file-duration" style="margin-left:auto">${fmtDuration(item.duration)}</span>`;
    dom.playlistPreview.appendChild(li);
  });

  dom.playlistCard.classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════════════
   Output summary (pre-merge duration + mode info)
   ════════════════════════════════════════════════════════════════ */
function updateOutputSummary() {
  const hasFiles = state.intro !== null || state.tracks.length > 0;
  if (!hasFiles) {
    dom.outputSummary.classList.add('hidden');
    state.totalOutputDuration = 0;
    return;
  }

  const totalSec = calculateTotalDuration();
  state.totalOutputDuration = totalSec;

  dom.summaryDuration.textContent = `Thời lượng: ${fmtDuration(totalSec)}`;

  const isVideo = Boolean(state.background);
  dom.summaryMode.textContent  = isVideo ? 'MP4 video' : 'Audio';
  dom.summaryMode.className    = `summary-mode ${isVideo ? 'mode-video' : 'mode-audio'}`;

  // Rough pre-start estimate for video mode only (audio is near-instant)
  if (isVideo && totalSec > 0) {
    // ultrafast H.264 typically encodes at 3-8× realtime for simple GIF/video backgrounds.
    // Use 3× as a conservative lower bound so the user isn't surprised.
    const minSec = totalSec / 8;
    const maxSec = totalSec / 3;
    dom.summaryHint.textContent =
      `Ước tính encode: ${fmtEta(minSec)} – ${fmtEta(maxSec)} (tuỳ CPU)`;
  } else {
    dom.summaryHint.textContent = '';
  }

  dom.outputSummary.classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════════════
   Merge button state
   ════════════════════════════════════════════════════════════════ */
function updateMergeButton() {
  const hasFiles  = state.intro !== null || state.tracks.length > 0;
  const hasOutput = Boolean(state.outputPath);
  dom.mergeBtn.disabled    = state.processing || !hasFiles || !hasOutput;
  dom.mergeBtn.textContent = state.background ? 'Merge to Video' : 'Merge Audio';
}

/* ════════════════════════════════════════════════════════════════
   Merge
   ════════════════════════════════════════════════════════════════ */
async function startMerge() {
  if (state.processing) return;

  hideStatus();
  stopPreview();

  state.processing    = true;
  state.mergeStartTime = Date.now();
  state.totalOutputDuration = calculateTotalDuration();

  dom.mergeBtn.disabled    = true;
  dom.mergeBtn.textContent = 'Processing...';
  dom.progressSection.classList.remove('hidden');
  dom.progressBar.style.width     = '0%';
  dom.progressPercent.textContent = '0%';
  dom.progressTime.textContent    = `0:00 / ${fmtDuration(state.totalOutputDuration)}`;
  dom.progressEta.textContent     = 'Đang tính...';

  const result = await window.api.mergeAudio({
    introPath:      state.intro?.path ?? null,
    contentPaths:   state.tracks.map((t) => t.path),
    repeatCount:    state.repeatCount,
    outputPath:     state.outputPath,
    backgroundPath: state.background?.path ?? null,
  });

  state.processing     = false;
  state.mergeStartTime = null;
  updateMergeButton();

  if (result.success) {
    dom.progressBar.style.width     = '100%';
    dom.progressPercent.textContent = '100%';
    dom.progressEta.textContent     = 'Hoàn tất';
    showStatusSuccess();
  } else {
    dom.progressSection.classList.add('hidden');
    showStatus(result.error || 'An unknown error occurred.', 'error');
  }
}

function showStatusSuccess() {
  const isVideo = Boolean(state.background);
  const msg     = document.createElement('div');
  msg.id        = 'status-msg';
  msg.className = 'status-msg is-success';
  msg.innerHTML = `${isVideo ? 'Video' : 'Audio'} đã ghép xong &#10003;<br>
    <button class="show-folder-btn" id="open-folder-btn">Show in Folder</button>`;

  const old = el('status-msg');
  if (old) old.replaceWith(msg);
  else dom.mergeBtn.after(msg);

  el('open-folder-btn').addEventListener('click', () => {
    window.api.showInFolder(state.outputPath);
  });
}

function showStatus(message, type) {
  let msgEl = el('status-msg');
  if (!msgEl) {
    msgEl    = document.createElement('div');
    msgEl.id = 'status-msg';
    dom.mergeBtn.after(msgEl);
  }
  msgEl.className   = `status-msg is-${type}`;
  msgEl.textContent = message;
  msgEl.classList.remove('hidden');
}

function hideStatus() {
  const msgEl = el('status-msg');
  if (msgEl) msgEl.classList.add('hidden');
}

/* ════════════════════════════════════════════════════════════════
   HTML escape helper
   ════════════════════════════════════════════════════════════════ */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════════════════════════════
   Start
   ════════════════════════════════════════════════════════════════ */
init();
