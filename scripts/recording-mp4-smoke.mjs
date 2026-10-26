/**
 * FFmpeg binary smoke test. It tests encoder availability, seekable MP4 output,
 * timestamps, and faststart on synthetic content; it is not a complete
 * Electron recording integration test.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const exe = process.env.CAPTURELINK_FFMPEG || resolve(
  'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
const dir = mkdtempSync(join(tmpdir(), 'capturelink-mp4-smoke-'))
const webm = join(dir, 'master.webm')
const mp4 = join(dir, 'finished.mp4')

function run(args, expected = 0) {
  const result = spawnSync(exe, ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.error || result.status !== expected) {
    throw new Error(`${exe} ${args.join(' ')} failed: ${result.error?.message || result.stderr}`)
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

try {
  run([
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '5', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
    '-b:v', '600k', '-c:a', 'libopus', webm
  ])
  run([
    '-y', '-i', webm, '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-fps_mode:v', 'vfr', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', mp4
  ])
  if (statSync(mp4).size < 4096) throw new Error('MP4 unexpectedly small')
  const streams = run(['-i', mp4], 1)
  if (!/Video:\s*h264/i.test(streams) || !/Audio:\s*aac/i.test(streams)) {
    throw new Error(`Unexpected output codecs:\n${streams}`)
  }
  if (!/Duration:\s*00:00:0[45]\./.test(streams)) {
    throw new Error(`Unexpected duration:\n${streams}`)
  }
  run(['-ss', '3', '-i', mp4, '-frames:v', '1', '-f', 'null', '-'])
  const bytes = readFileSync(mp4)
  const moov = bytes.indexOf(Buffer.from('moov'))
  const mdat = bytes.indexOf(Buffer.from('mdat'))
  if (moov < 0 || mdat < 0 || moov > mdat) {
    throw new Error('MP4 faststart index is missing or after media data')
  }
  console.log('PASS: Synthetic WebM -> H.264/AAC MP4, duration, sample seek, and faststart.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
