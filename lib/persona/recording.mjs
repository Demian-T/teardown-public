import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

const exec = promisify(execFile)

// Capture du viewport actif par Chrome, indépendante des captures prises après les actions.
export class ScreenRecording {
  constructor(context, path, viewport, { binary = process.env.FFMPEG_BIN || 'ffmpeg' } = {}) {
    this.context = context
    this.path = path
    this.viewport = viewport
    this.fps = 10
    this.binary = binary
    this.error = null
    this.stderr = ''
    this.durationSeconds = 0
  }

  async start(page) {
    const binary = this.binary
    await exec(binary, ['-version']).catch(() => {
      const error = new Error('FFmpeg requis pour la vidéo : installer ffmpeg, définir FFMPEG_BIN, ou utiliser --no-video')
      this.fail(error)
      throw error
    })
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const { width, height } = this.viewport
    this.process = spawn(binary, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(this.fps),
      '-use_wallclock_as_timestamps', '1', '-probesize', '32', '-analyzeduration', '0', '-i', 'pipe:0',
      '-an', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-r', String(this.fps), '-fps_mode', 'cfr', '-movflags', '+faststart',
      '-progress', 'pipe:3', '-f', 'mp4', `${this.path}.part`,
    ], { stdio: ['pipe', 'ignore', 'pipe', 'pipe'], windowsHide: true })
    this.exit = new Promise(resolve => {
      this.process.once('error', error => { this.fail(error); resolve({ error }) })
      this.process.once('close', (code, signal) => {
        if (code !== 0) this.fail(new Error(`FFmpeg interrompu (${code ?? signal}) : ${this.stderr.trim()}`))
        resolve({ code, signal })
      })
    })
    this.process.stdin.on('error', error => this.fail(error))
    this.process.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000) })
    let progress = ''
    this.process.stdio[3].on('data', data => {
      progress += data
      const lines = progress.split('\n'); progress = lines.pop()
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const value = Number(line.slice('out_time_us='.length))
          if (Number.isFinite(value)) this.durationSeconds = Math.max(0, value / 1e6)
        }
      }
    })
    try {
      await this.switchTo(page)
      const deadline = Date.now() + 8000
      while (!this.latest && !this.error && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      if (this.error) throw this.error
      if (!this.latest) throw new Error('Chrome ne fournit aucune image pour la vidéo')
      this.startedAt = new Date().toISOString()
      this.writeFrame()
      this.timer = setInterval(() => this.writeFrame(), 1000 / this.fps)
      return this.metadata('recording')
    } catch (error) {
      this.fail(error)
      await this.stop().catch(() => {})
      throw error
    }
  }

  fail(error) { this.error ||= error }

  writeFrame() {
    if (!this.latest || this.blocked || this.error || this.process.stdin.destroyed) return
    if (!this.process.stdin.write(this.latest)) {
      this.blocked = true
      this.process.stdin.once('drain', () => { this.blocked = false })
    }
  }

  async switchTo(page) {
    try {
      if (this.page === page) return
      await this.detach()
      this.page = page
      const session = await this.context.newCDPSession(page)
      this.cdp = session
      session.on('Page.screencastFrame', event => {
        if (this.cdp !== session) return
        this.latest = Buffer.from(event.data, 'base64')
        session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(error => {
          if (this.cdp === session && !this.stopping) this.fail(error)
        })
      })
      await page.bringToFront()
      await session.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: this.viewport.width, maxHeight: this.viewport.height, everyNthFrame: 1 })
    } catch (error) { this.fail(error); throw error }
  }

  async detach() {
    const session = this.cdp
    this.cdp = null
    if (!session) return
    await session.send('Page.stopScreencast').catch(() => {})
    await session.detach().catch(() => {})
  }

  metadata(status) {
    return { status, path: 'recordings/journey.mp4', mimeType: 'video/mp4', method: 'chrome-screencast', viewport: this.viewport, fps: this.fps, audio: false, ...(this.startedAt ? { startedAt: this.startedAt } : {}), ...(this.endedAt ? { endedAt: this.endedAt, durationSeconds: this.durationSeconds } : {}), ...(this.error ? { error: this.error.message } : {}) }
  }

  timeFor(at) { return Math.max(0, (Date.parse(at) - Date.parse(this.startedAt)) / 1000) }

  async stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.finish().catch(error => {
      this.fail(error)
      this.endedAt = new Date().toISOString()
      return this.metadata('failed')
    })
    return this.stopPromise
  }

  async finish() {
    this.stopping = true
    clearInterval(this.timer)
    await this.detach()
    if (!this.process) return this.metadata('failed')
    this.writeFrame()
    this.process.stdin.end()
    const timeout = setTimeout(() => { this.fail(new Error('Finalisation vidéo trop longue')); this.process.kill('SIGKILL') }, 15000)
    try { await this.exit } finally { clearTimeout(timeout) }
    this.endedAt = new Date().toISOString()
    if (this.error) return this.metadata('failed')
    if (!this.startedAt) { this.fail(new Error('Aucune image vidéo enregistrée')); return this.metadata('failed') }
    await rename(`${this.path}.part`, this.path)
    return this.metadata('ready')
  }
}
