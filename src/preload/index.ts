import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('captureLink', {
  platform: process.platform,
  version: '0.1.0'
})
