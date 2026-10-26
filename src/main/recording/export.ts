import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rename, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'

export type RecordingExportFormat = 'mp4' | 'mp3' | 'wav'

export interface RecordingExportSource {
  id: string
  kind: 'audio' | 'video'
  filePath: string
  durationMs: number
}

export interface FfmpegSupport {
  available: boolean
  detail: string
}

export interface FfmpegExportOptions {
  source: RecordingExportSource
  format: RecordingExportFormat
  outputPath: string
  onProgress?: (percent: number) => void
}

function getFfmpegCommand(): string {
  const configured = process.env.CAPTURELINK_FFMPEG?.trim()
  if (configured) {
    return configured
  }

  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

  // Installer releases must use the binary we ship, not an arbitrary PATH
  // entry. Avoid inadvertently changing codecs or output across machines.
  if (app.isPackaged && process.platform === 'win32') {
    return join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  }

  const development = join(process.cwd(), 'node_modules', 'ffmpeg-static', executable)
  if (existsSync(development)) {
    return development
  }

  // Non-packaged development fallback only.
  return executable
}

export async function getFfmpegSupport(): Promise<FfmpegSupport> {
  const command = getFfmpegCommand()

  if (app.isPackaged && process.platform === 'win32' && !existsSync(command)) {
    return {
      available: false,
      detail: 'Bundled FFmpeg is missing from CaptureLink. Reinstall the application.'
    }
  }

  return await new Promise((resolve) => {
    const child = spawn(command, ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let output = ''
    let settled = false
    const finish = (available: boolean, detail: string): void => {
      if (settled) return
      settled = true
      resolve({ available, detail })
    }

    const collect = (chunk: Buffer): void => {
      if (output.length < 1_000_000) output += chunk.toString()
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(false, error.code === 'ENOENT'
        ? 'FFmpeg is unavailable. Reinstall CaptureLink or configure CAPTURELINK_FFMPEG for development.'
        : `FFmpeg could not start: ${error.message}`)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        finish(false, `FFmpeg encoder check failed (exit ${code ?? 'unknown'}).`)
        return
      }

      // MPEG-4 Part 2 is not an acceptable silent substitute for H.264.
      // Check the actual encoder set, not merely that FFmpeg can launch.
      const missing = [
        !/\blibx264\b/.test(output) ? 'libx264 (H.264)' : null,
        !/\baac\b/.test(output) ? 'aac' : null
      ].filter((name): name is string => name !== null)
      if (missing.length) {
        finish(false, `FFmpeg is missing MP4 encoders: ${missing.join(', ')}.`)
        return
      }
      finish(true, 'MP4 export ready: H.264 (libx264) and AAC are available.')
    })
  })
}

function getRecordingExportArgs(
  source: RecordingExportSource,
  format: RecordingExportFormat,
  outputPath: string
): string[] {
  const common = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', source.filePath
  ]

  const progress = [
    '-progress', 'pipe:1',
    '-nostats'
  ]

  if (format === 'mp4') {
    return [
      ...common,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      // Chrome/Electron MediaRecorder WebM can advertise a nominal 1000 fps
      // time base even though real frames arrive at normal gameplay cadence.
      // Preserve the captured frame timestamps instead of letting FFmpeg's
      // automatic CFR behavior duplicate/drop frames during MP4 transcode.
      '-fps_mode:v', 'vfr',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      ...progress,
      outputPath
    ]
  }

  if (format === 'mp3') {
    return [
      ...common,
      '-vn',
      '-map', '0:a:0?',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      ...progress,
      outputPath
    ]
  }

  return [
    ...common,
    '-vn',
    '-map', '0:a:0?',
    '-c:a', 'pcm_s16le',
    ...progress,
    outputPath
  ]
}

function parseFfmpegProgressTime(line: string): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim())
  const raw = match?.[1]

  if (!raw) {
    return null
  }

  const microseconds = Number(raw)
  return Number.isFinite(microseconds) ? microseconds / 1000 : null
}

async function runFfmpegExport(
  options: FfmpegExportOptions
): Promise<void> {
  const { source, format, outputPath, onProgress } = options
  const command = getFfmpegCommand()
  const args = getRecordingExportArgs(source, format, outputPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let progressBuffer = ''
    let errorOutput = ''
    let settled = false

    const fail = (error: Error): void => {
      if (settled) {
        return
      }

      settled = true
      reject(error)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      progressBuffer += chunk
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const elapsedMs = parseFfmpegProgressTime(line)

        if (elapsedMs === null) {
          continue
        }

        const percent = source.durationMs > 0
          ? Math.max(0, Math.min(99, (elapsedMs / source.durationMs) * 100))
          : 0

        onProgress?.(percent)
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (errorOutput.length < 32768) {
        errorOutput += chunk.toString()
      }
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT'
        ? 'CaptureLink could not find FFmpeg. Install FFmpeg and make it available on PATH, or set CAPTURELINK_FFMPEG to a valid executable.'
        : `FFmpeg could not start: ${error.message}`

      fail(new Error(message))
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      settled = true

      if (code === 0) {
        resolve()
        return
      }

      const tail = errorOutput
        .trim()
        .split(/\r?\n/)
        .slice(-8)
        .join('\n')

      reject(new Error(
        `FFmpeg export failed with code ${code ?? 'unknown'}` +
        (tail ? `:\n${tail}` : '.')
      ))
    })
  })
}

/**
 * Encode to a sibling temporary file and publish only after successful exit.
 * The requested destination is never a partially encoded "finished" video.
 * The WebM master always stays untouched.
 */
export async function exportRecordingWithFfmpeg(
  options: FfmpegExportOptions
): Promise<void> {
  if (join(dirname(options.source.filePath), basename(options.source.filePath)) ===
      join(dirname(options.outputPath), basename(options.outputPath))) {
    throw new Error('Export destination cannot overwrite the recording source.')
  }

  const extension = options.format
  const temporary = join(
    dirname(options.outputPath),
    `.${basename(options.outputPath)}.${randomUUID()}.partial.${extension}`
  )

  try {
    await runFfmpegExport({ ...options, outputPath: temporary })
    const result = await stat(temporary)
    if (!result.isFile() || result.size < 1024) {
      throw new Error('FFmpeg produced an empty or incomplete output.')
    }
    await rename(temporary, options.outputPath)
    options.onProgress?.(100)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
