'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only bridge into the main process: one named RPC call. The main process
// decides what each method may do, so the renderer gets no direct DB or fs access.
contextBridge.exposeInMainWorld('pharmacy', {
  call: (method, args) => ipcRenderer.invoke('pharmacy:call', method, args),
});
