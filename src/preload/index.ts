import { contextBridge, ipcRenderer } from 'electron'

interface IceCandidatePayload {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

contextBridge.exposeInMainWorld('captureLink', {
  platform: process.platform,
  version: '0.1.0',

  getXboxAuthStatus: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-status'),

  getXboxConsoles: () =>
    ipcRenderer.invoke('capturelink:xbox-consoles'),

  startXboxAuth: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-start'),

  startXboxStream: (serverId: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-start', serverId),

  exchangeXboxSdp: (sdp: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-sdp', sdp),

  exchangeXboxIce: (candidates: IceCandidatePayload[]) =>
    ipcRenderer.invoke('capturelink:xbox-stream-ice', candidates),

  exchangeXboxChatSdp: (sdp: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-chat-sdp', sdp),

  stopXboxStream: () =>
    ipcRenderer.invoke('capturelink:xbox-stream-stop'),


  beginRecording: (
    kind: 'audio' | 'video',
    suggestedName: string
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-begin',
      { kind, suggestedName }
    ),

  appendRecordingChunk: (
    recordingId: string,
    data: ArrayBuffer
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-append',
      { recordingId, data }
    ),

  finalizeRecording: (recordingId: string) =>
    ipcRenderer.invoke(
      'capturelink:recording-finalize',
      recordingId
    ),

  cancelRecording: (recordingId: string) =>
    ipcRenderer.invoke(
      'capturelink:recording-cancel',
      recordingId
    ),

  getRecordings: () =>
    ipcRenderer.invoke('capturelink:recordings-list'),

  openRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-open', id),

  showRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-show', id),

  renameRecording: (id: string, name: string) =>
    ipcRenderer.invoke(
      'capturelink:recordings-rename',
      { id, name }
    ),

  deleteRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-delete', id),

  exportOriginalRecording: (id: string) =>
    ipcRenderer.invoke(
      'capturelink:recordings-export-original',
      id
    ),


  onXboxAuthOutput: (
    callback: (message: string) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-auth-output',
      (_event, message: string) => callback(message)
    )
  },

  onXboxAuthComplete: (
    callback: (
      result: {
        success: boolean
        message: string
      }
    ) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-auth-complete',
      (_event, result) => callback(result)
    )
  },

  onRecordingStopRequested: (
    callback: () => void
  ) => {
    ipcRenderer.on(
      'capturelink:recording-stop-request',
      () => callback()
    )
  },

  onXboxStreamStatus: (
    callback: (status: string) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-stream-status',
      (_event, status: string) => callback(status)
    )
  }
})
