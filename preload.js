'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL }              = require('url');

contextBridge.exposeInMainWorld('api', {
  /* ── File dialogs ── */
  openAudioFiles:      (opts) => ipcRenderer.invoke('dialog:openAudioFiles', opts),
  openBackgroundFile:  ()     => ipcRenderer.invoke('dialog:openBackgroundFile'),
  saveOutputFile:      (opts) => ipcRenderer.invoke('dialog:saveOutputFile', opts),

  /* ── Audio operations ── */
  getAudioInfo:    (p)     => ipcRenderer.invoke('audio:getInfo', p),
  checkFFmpeg:     ()      => ipcRenderer.invoke('ffmpeg:check'),
  mergeAudio:      (opts)  => ipcRenderer.invoke('audio:merge', opts),

  /* ── Shell helpers ── */
  showInFolder:    (p)     => ipcRenderer.invoke('shell:showInFolder', p),

  /* ── Progress subscription ── */
  onMergeProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('merge:progress', handler);
    // Returns an unsubscribe function
    return () => ipcRenderer.removeListener('merge:progress', handler);
  },

  /* ── Utility ── */
  // Converts a native file-system path to a file:// URL the renderer can use
  toFileUrl: (p) => pathToFileURL(p).href,
});
