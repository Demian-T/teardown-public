import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { RunStore } from '../lib/persona/runs.mjs'
import { PersonaBrowser } from '../lib/persona/browser.mjs'

const browserTests = process.env.RUN_BROWSER_TESTS === '1'
async function fixture(t, html) {
  const root = await mkdtemp(join(tmpdir(), 'persona-regression-'))
  let mutations = 0, browser
  const server = createServer((request, response) => {
    if (request.url === '/mutation') mutations++
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url === '/next' ? '<h1>Deuxième page</h1>' : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    try { await browser?.close() } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const persona = { schemaVersion: 1, id: 'fixture', name: 'Fixture technique', context: 'Test local', goal: 'Consulter une information', profile: { digitalExperience: 'Déclarée', priorKnowledge: 'Aucune' }, behavior: { reading: 'Lire', navigation: 'Liens visibles', decisionCriteria: ['Information'], avoidances: [], recovery: 'Arrêter' }, scenario: { startUrl: `${origin}/`, allowedOrigins: [origin], device: 'desktop', maxActions: 8, maxMinutes: 2, maxConsecutiveFailures: 2, allowFormInput: false, successCriteria: [{ id: 'read', label: 'Information observée' }] }, assumptions: [] }
  const store = new RunStore(root), directory = await store.start(persona, 'playwright')
  browser = new PersonaBrowser(store, directory)
  const first = await browser.open({ headless: true, video: false })
  const act = (observation, action) => browser.act({ reason: 'Vérification technique', expectation: 'Résultat observable', observationId: observation.id, ...action })
  return { browser, store, directory, first, origin, act, mutations: () => mutations }
}

test('onglet vide non bloquant, retour au parent et historique absent signalé', { skip: !browserTests }, async t => {
  const f = await fixture(t, '<h1>Accueil</h1><a href="/next" target="_blank">Suite</a>')
  const blank = await f.browser.session.context.newPage()
  const next = await f.act(f.first, { type: 'click', element: f.first.elements.find(el => el.label === 'Suite').ref })
  assert.equal(next.observation.url, `${f.origin}/next`)
  const back = await f.act(next.observation, { type: 'back' })
  assert.equal(back.observation.url, `${f.origin}/`)
  await blank.close()
  const observed = await f.act(back.observation, { type: 'observe' })
  assert.equal(observed.status, 'ok')
  const emptyBack = await f.act(observed.observation, { type: 'back' })
  assert.equal(emptyBack.status, 'failed')
  assert.match(emptyBack.error, /historique précédent/)
})

for (const [name, control] of [
  ['title', '<button title="Supprimer" style="width:60px;height:40px" onclick="fetch(\'/mutation\')"></button>'],
  ['label', '<label for="danger">Supprimer</label><input id="danger" type="button" value="" onclick="fetch(\'/mutation\')">'],
]) test(`garde de clic : libellé ${name} utilisé sans déclencher l’action`, { skip: !browserTests }, async t => {
  const f = await fixture(t, `<h1>Contrôle</h1>${control}`)
  const target = f.first.elements.find(el => el.label === 'Supprimer')
  assert.ok(target)
  const result = await f.act(f.first, { type: 'click', element: target.ref })
  assert.equal(result.status, 'boundary')
  assert.equal(f.mutations(), 0)
})

test('capture après action indisponible : action conservée, observation non inventée', { skip: !browserTests }, async t => {
  const f = await fixture(t, '<h1>Contrôle</h1><button type="button" onclick="window.changed=true">Changer</button>')
  f.browser.observe = async () => { throw new Error('Capture interrompue') }
  const result = await f.act(f.first, { type: 'click', element: f.first.elements.find(el => el.label === 'Changer').ref })
  assert.equal(await f.browser.page.evaluate(() => window.changed), true)
  assert.equal(result.status, 'failed')
  const run = await f.store.load(f.directory)
  assert.equal(run.events.length, 2)
  assert.equal(run.events[1].after.unavailable, true)
  assert.equal(run.events[1].after.screenshot, undefined)
  assert.equal(run.pendingAction, undefined)
  await assert.rejects(f.act(result.observation, { type: 'observe' }), /Observation indisponible/)
})

test('échec de journalisation : intention durable et aucun rejeu aveugle', { skip: !browserTests }, async t => {
  const f = await fixture(t, '<h1>Contrôle</h1><button type="button" onclick="window.changed=true">Changer</button>')
  f.store.record = async () => { throw new Error('Stockage indisponible') }
  await assert.rejects(f.act(f.first, { type: 'click', element: f.first.elements.find(el => el.label === 'Changer').ref }), /journalisation incomplète/)
  assert.equal(await f.browser.page.evaluate(() => window.changed), true)
  const run = await f.store.load(f.directory)
  assert.equal(run.events.length, 1)
  assert.equal(run.pendingAction.action.type, 'click')
  await assert.rejects(f.act(f.first, { type: 'observe' }), /Journal incomplet/)
})
