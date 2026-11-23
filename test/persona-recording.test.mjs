import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { ScreenRecording } from '../lib/persona/recording.mjs'
import { inspectVideo } from '../lib/persona/media.mjs'
import { RunStore, PRIVATE_ROOT, ROOT } from '../lib/persona/runs.mjs'
import { PersonaBrowser } from '../lib/persona/browser.mjs'
import { launchChromeCDP } from '../lib/chrome-cdp.mjs'

const exec = promisify(execFile)
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg'
const ffprobe = process.env.FFPROBE_BIN || 'ffprobe'
const videoTests = process.env.RUN_VIDEO_TESTS === '1'
const persona = origin => ({ schemaVersion: 1, id: 'video-fixture', name: 'Fixture vidéo', context: 'Test technique local', goal: 'Observer deux écrans', profile: { digitalExperience: 'Déclarée', priorKnowledge: 'Aucune' }, behavior: { reading: 'Lire les titres', navigation: 'Liens visibles', decisionCriteria: ['Détail visible'], avoidances: [], recovery: 'Arrêter' }, scenario: { startUrl: `${origin}/`, allowedOrigins: [origin], device: 'desktop', maxActions: 8, maxMinutes: 2, maxConsecutiveFailures: 2, allowFormInput: false, successCriteria: [{ id: 'view', label: 'Deuxième écran observé' }] }, assumptions: [] })

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'persona-video-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  return root
}

async function fixtureServer(t) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url === '/next' ? '<body style="background:blue;color:white"><h1>Second écran</h1>' : '<style>body{background:red;color:white}i{position:absolute;top:200px;width:80px;height:80px;background:lime;animation:move 1.1s linear infinite alternate}@keyframes move{from{left:0}to{left:500px}}</style><h1>Premier écran</h1><a style="color:white" href="/next" target="_blank">Suite</a><i></i>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

test('vidéo : dépendance absente et faux fichiers signalés', async t => {
  const root = await temporary(t)
  const recorder = new ScreenRecording(null, join(root, 'journey.mp4'), { width: 1440, height: 900 }, { binary: join(root, 'absent-ffmpeg') })
  await assert.rejects(recorder.start(null), /FFmpeg requis/)
  assert.equal((await recorder.stop()).status, 'failed')
  const fake = join(root, 'fake.mp4')
  await writeFile(fake, 'Ce fichier ne contient aucune vidéo')
  await assert.rejects(inspectVideo(fake), /contenu/)
  const store = new RunStore(root)
  const directory = await store.start(persona('https://example.com'), 'aside')
  await assert.rejects(store.attachRecording(directory, fake), /contenu/)
  await assert.rejects(store.setRecording(directory, { status: 'ready', path: '../outside.mp4' }), /rester/)
})

test('vidéo continue : animation entre actions, popup, durée, import et lecteur', { skip: !videoTests, timeout: 60000 }, async t => {
  const root = await temporary(t), origin = await fixtureServer(t)
  const store = new RunStore(root), directory = await store.start(persona(origin), 'playwright')
  const browser = new PersonaBrowser(store, directory)
  t.after(() => browser.close())
  const first = await browser.open({ headless: true })
  const startedAt = Date.parse((await store.load(directory)).recording.startedAt)
  const idleStart = (Date.now() - startedAt) / 1000
  // Aucun événement persona pendant cette animation : la vidéo doit tout de même la capter.
  await browser.page.waitForTimeout(2200)
  const next = await browser.act({ type: 'click', element: first.elements.find(element => element.label === 'Suite').ref, observationId: first.id, reason: 'Voir le détail', expectation: 'Deuxième écran' })
  assert.equal(next.observation.url, `${origin}/next`)
  await browser.page.waitForTimeout(1000)
  await assert.rejects(store.finish(directory, { outcome: 'success' }), /finaliser la vidéo/)
  await browser.close()
  const run = await store.load(directory)
  assert.equal(run.recording.status, 'ready')
  const path = join(directory, run.recording.path)
  const probe = JSON.parse((await exec(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])).stdout)
  assert.equal(probe.streams.length, 1)
  assert.equal(probe.streams[0].codec_name, 'h264')
  assert.equal(probe.streams[0].width, 1440)
  assert.equal(probe.streams[0].height, 900)
  assert.ok(Number(probe.streams[0].nb_frames) > run.events.length * 10)
  const duration = Number(probe.format.duration)
  assert.ok(Math.abs(duration - (Date.parse(run.recording.endedAt) - startedAt) / 1000) < 1)
  const hashes = (await exec(ffmpeg, ['-v', 'error', '-ss', String(idleStart), '-i', path, '-t', '1.8', '-vf', 'crop=640:150:0:180', '-f', 'framemd5', '-'])).stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim())
  assert.ok(new Set(hashes).size > 2, 'L’animation doit évoluer pendant une pause entre deux actions')
  const lastPixel = (await exec(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, duration - 0.5)), '-i', path, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout
  assert.ok(lastPixel[2] > lastPixel[0] + 100, 'Le dernier écran doit être le nouvel onglet bleu')
  await store.finish(directory, { outcome: 'success', summary: 'Deuxième écran observé', criteria: [{ id: 'view', met: true, evidence: 'Second écran', eventSequences: [2] }] })
  const external = await store.start(persona(origin), 'claude-in-chrome')
  await store.attachRecording(external, path)
  assert.equal((await store.load(external)).recording.method, 'imported')
  await assert.rejects(store.attachRecording(external, path), /existe déjà/)
  const viewer = await launchChromeCDP({ profileDir: join(root, 'viewer-profile'), headless: true })
  try {
    const page = viewer.context.pages()[0]
    await page.goto(pathToFileURL(join(directory, 'index.html')).href)
    await page.waitForFunction(() => document.querySelector('video').readyState >= 1)
    assert.equal(await page.locator('[data-video-time]').count(), 2)
    await page.locator('[data-video-time]').last().click()
    await page.waitForFunction(time => document.querySelector('video').currentTime >= time - 0.2, next.observation ? run.events[1].videoTimeSeconds : 0)
    assert.ok(await page.locator('video').evaluate(video => !video.error))
  } finally { await viewer.close() }
})

test('vidéo du CLI finalisée sur SIGINT', { skip: !videoTests, timeout: 45000 }, async t => {
  const origin = await fixtureServer(t)
  const store = new RunStore(PRIVATE_ROOT), directory = await store.start(persona(origin), 'playwright')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const child = spawn(process.execPath, ['persona.mjs', 'browser', directory, '--headless'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  let output = '', error = ''
  child.stderr.on('data', data => { error += data })
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    child.stdout.on('data', data => { output += data; if (output.includes('"ready":true')) resolve() })
    child.once('exit', () => reject(new Error(`CLI fermé avant le premier écran : ${error}`)))
    child.once('error', reject)
  })
  child.kill('SIGINT')
  assert.equal((await exit).code, 0, error)
  assert.equal((await store.load(directory)).recording.status, 'ready')
})
