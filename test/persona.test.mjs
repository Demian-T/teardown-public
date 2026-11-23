import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../lib/persona/runs.mjs'
import { validatePersona, assertSafeClick, validateResult } from '../lib/persona/model.mjs'

export const fixture = (origin = 'https://example.com') => ({
  schemaVersion: 1, id: 'fixture', name: 'Fixture technique', context: 'Test de fonctionnement', goal: 'Trouver une information visible',
  profile: { digitalExperience: 'Déclarée', priorKnowledge: 'Aucune' },
  behavior: { reading: 'Lire les titres', navigation: 'Choisir un lien pertinent', decisionCriteria: ['Information explicite'], avoidances: [], recovery: 'Revenir puis arrêter' },
  scenario: { startUrl: `${origin}/`, device: 'desktop', allowedOrigins: [origin], maxActions: 5, maxMinutes: 2, maxConsecutiveFailures: 2, allowFormInput: false, successCriteria: [{ id: 'found', label: 'Information trouvée' }] },
  assumptions: [],
})
const event = () => ({ action: { type: 'click', reason: 'Lien pertinent pour l’objectif', expectation: 'Lire l’information' }, before: { url: 'https://example.com/', text: 'Lien', captureRef: 'tool:before' }, after: { url: 'https://example.com/info', text: 'Information', captureRef: 'tool:after' }, status: 'ok' })

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'persona-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('persona : origines exactes, critères uniques et budgets valides', () => {
  assert.equal(validatePersona(fixture()).id, 'fixture')
  const wrong = fixture(); wrong.scenario.allowedOrigins = ['https://example.com/']
  assert.throws(() => validatePersona(wrong), /origines/)
  const credentials = fixture(); credentials.scenario.startUrl = 'https://user:secret@example.com/'
  assert.throws(() => validatePersona(credentials), /identifiants/)
  const duplicate = fixture(); duplicate.scenario.successCriteria.push(duplicate.scenario.successCriteria[0])
  assert.throws(() => validatePersona(duplicate), /unique/)
})

test('aucun bouton de soumission ni lien externe autorisé par le garde local', () => {
  const persona = fixture()
  assert.throws(() => assertSafeClick({ label: 'Continuer', submit: true }, persona), /Soumission/)
  assert.throws(() => assertSafeClick({ label: 'Envoyer ma demande' }, persona), /effet de bord/)
  assert.throws(() => assertSafeClick({ label: 'Offre', href: 'https://other.example/offre' }, persona), /origines/)
  assert.doesNotThrow(() => assertSafeClick({ label: 'Découvrir les offres', href: 'https://example.com/offres' }, persona))
})

test('copie figée du persona, journal terminal et preuves du succès', async t => {
  const root = await temporary(t)
  const store = new RunStore(root)
  const persona = fixture()
  const directory = await store.start(persona, 'claude-in-chrome')
  persona.goal = 'Modification ultérieure'
  assert.equal((await store.load(directory)).persona.goal, 'Trouver une information visible')
  await store.record(directory, event())
  const result = { outcome: 'success', summary: 'Information observée', criteria: [{ id: 'found', met: true, evidence: 'Texte de l’étape 1', eventSequences: [1] }] }
  const current = await store.load(directory)
  assert.throws(() => validateResult({ ...result, criteria: [{ ...result.criteria[0], eventSequences: [99] }] }, current), /inexistant/)
  await store.finish(directory, result)
  await assert.rejects(store.record(directory, event()), /terminé/)
  assert.match(await readFile(join(directory, 'index.html'), 'utf8'), /Objectif atteint/)
})

test('budgets, échecs et limite de périmètre arrêtent la progression', async t => {
  const store = new RunStore(await temporary(t))
  const persona = fixture(); persona.scenario.maxActions = 1
  const budget = await store.start(persona, 'aside')
  await store.record(budget, event())
  await assert.rejects(store.record(budget, event()), /Budget d’actions/)
  const boundary = await store.start(fixture(), 'browser-use')
  const external = event(); external.after.url = 'https://other.example/'; external.status = 'boundary'
  await store.record(boundary, external)
  await assert.rejects(store.record(boundary, event()), /Limite rencontrée/)
  const blank = await store.start(fixture(), 'codex')
  const blankEvent = event(); blankEvent.after.url = 'about:blank'; blankEvent.status = 'boundary'
  await store.record(blank, blankEvent)
  assert.equal((await store.load(blank)).events[0].after.url, 'about:blank')
  const failures = await store.start(fixture(), 'codex')
  await store.record(failures, { ...event(), status: 'failed' })
  await store.record(failures, { ...event(), status: 'failed' })
  await assert.rejects(store.record(failures, event()), /échecs consécutifs/)
  const timed = await store.start(fixture(), 'aside')
  const run = await store.load(timed); run.startedAt = new Date(Date.now() - 180000).toISOString()
  await store.save(timed, run)
  await assert.rejects(store.record(timed, event()), /Budget de temps/)
  // An action begun within budget must retain its evidence even if capture finishes later.
  const longAction = event(); longAction.startedAt = new Date(Date.parse(run.startedAt) + 30000).toISOString()
  await store.record(timed, longAction)
  await assert.rejects(store.record(timed, event()), /Budget de temps/)
})

test('une réussite ne peut masquer un critère absent ; HTML échappé', async t => {
  const store = new RunStore(await temporary(t))
  const persona = fixture(); persona.name = '<script>private()</script>'
  const directory = await store.start(persona, 'aside')
  await store.record(directory, event())
  await assert.rejects(store.finish(directory, { outcome: 'success', summary: 'Incomplet', criteria: [{ id: 'found', met: false, evidence: 'Absent', eventSequences: [] }] }), /incomplets/)
  await assert.rejects(store.finish(directory, { outcome: 'success', summary: 'Sans preuve', criteria: [{ id: 'found', met: true, evidence: 'Affirmation', eventSequences: [] }] }), /événement de preuve/)
  const html = await readFile(join(directory, 'index.html'), 'utf8')
  assert.ok(!html.includes('<script>private()'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('stockage privé : traversée de chemin, symlink et capture manquante refusés', async t => {
  const root = await temporary(t)
  const privateRoot = join(root, 'private')
  const store = new RunStore(privateRoot)
  await assert.rejects(store.write(join(root, 'public.json'), {}), /privé/)
  await mkdir(privateRoot, { recursive: true }); await mkdir(join(root, 'outside'))
  await symlink(join(root, 'outside'), join(privateRoot, 'escape'))
  await assert.rejects(store.write(join(privateRoot, 'escape', 'private.json'), {}), /symbolique/)
  const directory = await store.start(fixture(), 'aside')
  const missing = event(); missing.after.screenshot = 'screens/missing.png'
  await assert.rejects(store.record(directory, missing), /ENOENT|absente/)
})
