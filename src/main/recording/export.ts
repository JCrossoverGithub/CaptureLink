import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'

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
  return configured || 'ffmpeg'
}

export async function getFfmpegSupport(): Promise<FfmpegSupport> {
  const command = getFfmpegCommand()

  return await new Promise((resolve) => {
    const child = spawn(command, ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let output = ''
    let settled = false

    const finish = (available: boolean, detail: string): void => {
      if (settled) {
        return
      }

      settled = true
      resolve({ available, detail })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 4096) {
        output += chunk.toString()
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (output.length < 4096) {
        output += chunk.toString()
      }
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const detail = error.code === 'ENOENT'
        ? 'FFmpeg was not found. Install FFmpeg or set CAPTURELINK_FFMPEG to the executable path.'
        : `FFmpeg could not start: ${error.message}`

      finish(false, detail)
    })

    child.on('close', (code) => {
      if (code === 0) {
        const firstLine = output.split(/\r?\n/, 1)[0]?.trim()
        finish(true, firstLine || `FFmpeg is available through ${command}.`)
      } else {
        finish(
          false,
          `FFmpeg availability check exited with code ${code ?? 'unknown'}.`
        )
      }
    })
  })
}

function getRecordingExportArgs(
  source: RecordingExportSource,
  format: RecordingExportFormat,
  outputPath: string,
  fallbackVideoEncoder = false
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
    const videoArgs = fallbackVideoEncoder
      ? ['-c:v', 'mpeg4', '-q:v', '3']
      : [
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-pix_fmt', 'yuv420p'
        ]

    return [
      ...common,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      ...videoArgs,
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
  options: FfmpegExportOptions,
  fallbackVideoEncoder = false
): Promise<void> {
  const { source, format, outputPath, onProgress } = options
  const command = getFfmpegCommand()
  const args = getRecordingExportArgs(
    source,
    format,
    outputPath,
    fallbackVideoEncoder
  )

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
        ? 'FFmpeg was not found. Install FFmpeg or set CAPTURELINK_FFMPEG to the executable path.'
        : `FFmpeg could not start: ${error.message}`

      fail(new Error(message))
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      settled = true

      if (code === 0) {
        onProgress?.(100)
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

export async function exportRecordingWithFfmpeg(
  options: FfmpegExportOptions
): Promise<void> {
  try {
    await runFfmpegExport(options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const canFallback = options.format === 'mp4' &&
      /Unknown encoder ['"]?libx264|Encoder \(codec h264\) not found/i.test(message)

    if (!canFallback) {
      throw error
    }

    await unlink(options.outputPath).catch(() => undefined)
    console.warn(
      '[CaptureLink] libx264 unavailable; retrying MP4 export with FFmpeg MPEG-4 encoder.'
    )
    await runFfmpegExport(options, true)
  }
}
