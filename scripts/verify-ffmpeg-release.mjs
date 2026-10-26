import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform !== 'win32') {
  console.error('CaptureLink Windows installer FFmpeg verification must run on Windows. Use Windows PowerShell.')
  process.exit(1)
}

const binary = resolve('node_modules', 'ffmpeg-static', 'ffmpeg.exe')
try {
  if (statSync(binary).size < 1_000_000) {
    throw new Error('FFmpeg executable is unexpectedly small')
  }
} catch (error) {
  console.error(`FFmpeg executable unavailable: ${binary}`)
  console.error('Ensure ffmpeg-static install scripts completed. Do not distribute without its binary.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const result = spawnSync(binary, ['-hide_banner', '-encoders'], {
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024
})
if (result.error || result.status !== 0) {
  console.error('Could not inspect the bundled FFmpeg encoder list.', result.error || result.stderr)
  process.exit(1)
}
const encoders = `${result.stdout || ''}\n${result.stderr || ''}`
const missing = ['libx264', 'aac'].filter((encoder) => !new RegExp(`\\b${encoder}\\b`).test(encoders))
if (missing.length) {
  console.error(`FFmpeg is missing encoders required for H.264/AAC MP4: ${missing.join(', ')}`)
  process.exit(1)
}

console.log('PASS: Windows FFmpeg binary exists and provides libx264 and AAC encoders.')
console.log('NOTICE: Confirm the exact FFmpeg binary redistribution license and notices before publishing the installer.')
