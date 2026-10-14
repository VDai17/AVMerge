'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const { checkFFmpeg, getAudioInfo, mergeAudioFiles, mergeWithBackground } = require('./src/audioProcessor');
const { generatePlaylist }                            = require('./src/playlistGenerator');
const { validateAllFiles }                            = require('./src/fileManager');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     960,
    height:    720,
    minWidth:  800,
    minHeight: 600,
    title:     'AVMerge',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false, // Allow file:// access for audio preview
    },
  });

  mainWindow.loadFile('renderer/index.html');

  // Open DevTools only in development:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: open audio file picker ──────────────────────────────────────────────
ipcMain.handle('dialog:openAudioFiles', async (_event, { multiple, title }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select Audio Files',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'] },
      { name: 'All Files',   extensions: ['*'] },
    ],
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  return result.canceled ? null : result.filePaths;
});

// ── IPC: open background visual picker (GIF or silent video) ─────────────────
ipcMain.handle('dialog:openBackgroundFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:   'Select Background Visual',
    filters: [
      { name: 'GIF / Video', extensions: ['gif', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v'] },
      { name: 'All Files',   extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: save-as dialog for output ───────────────────────────────────────────
ipcMain.handle('dialog:saveOutputFile', async (_event, { defaultName, videoMode }) => {
  const filters = videoMode
    ? [{ name: 'MP4 Video', extensions: ['mp4'] }]
    : [
        { name: 'MP3',  extensions: ['mp3'] },
        { name: 'WAV',  extensions: ['wav'] },
        { name: 'M4A',  extensions: ['m4a'] },
        { name: 'AAC',  extensions: ['aac'] },
        { name: 'OGG',  extensions: ['ogg'] },
        { name: 'FLAC', extensions: ['flac'] },
      ];

  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'Save Merged File',
    defaultPath: defaultName || (videoMode ? 'output.mp4' : 'output.mp3'),
    filters,
  });
  return result.canceled ? null : result.filePath;
});

// ── IPC: probe a single audio file ───────────────────────────────────────────
ipcMain.handle('audio:getInfo', async (_event, filePath) => {
  try {
    const info = await getAudioInfo(filePath);
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: check FFmpeg ─────────────────────────────────────────────────────────
ipcMain.handle('ffmpeg:check', async () => {
  return checkFFmpeg();
});

// ── IPC: merge ────────────────────────────────────────────────────────────────
ipcMain.handle('audio:merge', async (_event, { introPath, contentPaths, repeatCount, outputPath, backgroundPath }) => {
  // Build ordered playlist
  let playlist;
  try {
    playlist = generatePlaylist(introPath || null, contentPaths || [], repeatCount);
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (playlist.length === 0) {
    return { success: false, error: 'No audio files selected.' };
  }

  // Validate audio files
  const errors = validateAllFiles(playlist);
  if (errors.length > 0) {
    return { success: false, error: errors.join('\n') };
  }

  // Validate background visual if provided
  if (backgroundPath && !fs.existsSync(backgroundPath)) {
    return { success: false, error: `Background file not found: ${path.basename(backgroundPath)}` };
  }

  // Confirm overwrite if output exists
  if (fs.existsSync(outputPath)) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type:      'question',
      buttons:   ['Overwrite', 'Cancel'],
      defaultId: 1,
      title:     'File Already Exists',
      message:   `"${path.basename(outputPath)}" already exists. Overwrite it?`,
    });
    if (response === 1) {
      return { success: false, error: 'Cancelled — output file already exists.' };
    }
  }

  try {
    const mergeFn = backgroundPath
      ? (files, out, cb) => mergeWithBackground(files, backgroundPath, out, cb)
      : mergeAudioFiles;

    await mergeFn(playlist, outputPath, (progress) => {
      mainWindow.webContents.send('merge:progress', progress);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: reveal in Explorer / Finder ─────────────────────────────────────────
ipcMain.handle('shell:showInFolder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});
