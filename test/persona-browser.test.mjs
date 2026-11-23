import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { RunStore } from '../lib/persona/runs.mjs'
import { PersonaBrowser } from '../lib/persona/browser.mjs'

test('navigateur : cible visible, observation courante et arrêt avant envoi', { skip: process.env.RUN_BROWSER_TESTS !== '1' }, async t => {
  let submissions = 0
  const server = createServer((request, response) => {
    if (request.method === 'POST') submissions++
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(request.url === '/popup' ? '<h1>Nouvel onglet</h1><form method="POST"><button>Envoyer la demande</button></form>' : '<h1>Offre de test</h1><a href="/popup" target="_blank">Ouvrir le détail</a><form method="POST"><button>Envoyer la demande</button></form><button style="position:fixed;right:20px;top:650px">Masqué par le panneau</button><button style="position:fixed;left:500px;top:-30px;height:40px">Cible partielle</button><div style="position:fixed;right:0;top:600px;width:400px;height:200px;background:white;z-index:99">Panneau superposé</div><p style="position:fixed;top:865px;left:20px;width:150px;font:16px/24px Arial">Visible puis des mots qui descendent sous la limite Secretbelow</p><div style="margin-top:1800px"><a href="/hidden">Cible en bas</a><p>Texte hors écran</p></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const root = await mkdtemp(join(tmpdir(), 'persona-browser-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const origin = `http://127.0.0.1:${server.address().port}`
  const persona = { schemaVersion: 1, id: 'fixture', name: 'Fixture technique', context: 'Vérification locale', goal: 'Lire une information', profile: { digitalExperience: 'Déclarée', priorKnowledge: 'Aucune' }, behavior: { reading: 'Lire', navigation: 'Cliquer un lien visible', decisionCriteria: ['Détail'], avoidances: [], recovery: 'Arrêter' }, scenario: { startUrl: `${origin}/`, allowedOrigins: [origin], device: 'desktop', maxActions: 8, maxMinutes: 2, maxConsecutiveFailures: 2, allowFormInput: false, successCriteria: [{ id: 'read', label: 'Information lue' }] }, assumptions: [] }
  const store = new RunStore(root)
  const directory = await store.start(persona, 'playwright')
  const browser = new PersonaBrowser(store, directory)
  t.after(() => browser.close())
  const first = await browser.open({ headless: true })
  assert.ok(!first.elements.some(element => element.label === 'Cible en bas'))
  assert.ok(!first.text.includes('Texte hors écran'))
  assert.ok(!first.elements.some(element => ['Masqué par le panneau', 'Cible partielle'].includes(element.label)))
  assert.ok(!first.text.includes('Masqué par le panneau'))
  assert.ok(first.text.includes('Visible'))
  assert.ok(!first.text.includes('Secretbelow'))
  await assert.rejects(browser.act({ type: 'click', element: first.elements[0].ref, observationId: 'stale', reason: 'Lire', expectation: 'Détail' }), /périmée/)
  const popup = await browser.act({ type: 'click', element: first.elements.find(element => element.label === 'Ouvrir le détail').ref, observationId: first.id, reason: 'Lire le détail', expectation: 'Ouvrir le nouvel onglet' })
  assert.equal(popup.observation.url, `${origin}/popup`)
  assert.equal(popup.observation.viewport.width, 1440)
  const next = await browser.act({ type: 'observe', observationId: popup.observation.id, reason: 'Relire le détail', expectation: 'Rester dans le même onglet' })
  assert.equal(next.observation.url, `${origin}/popup`)
  const button = next.observation.elements.find(element => element.label === 'Envoyer la demande')
  const result = await browser.act({ type: 'click', element: button.ref, observationId: next.observation.id, reason: 'Vérifier la protection', expectation: 'Arrêt avant envoi' })
  assert.equal(result.status, 'boundary')
  assert.equal(submissions, 0)
  await assert.rejects(browser.act({ type: 'observe', observationId: result.observation.id, reason: 'Suite', expectation: 'Suite' }), /Limite/)
})
