#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { RunStore, PRIVATE_ROOT, ROOT, readJson } from './lib/persona/runs.mjs'
import { validatePersona, PROVIDERS } from './lib/persona/model.mjs'
import { PersonaBrowser } from './lib/persona/browser.mjs'

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv
  const flags = Object.fromEntries(args.filter(value => value.startsWith('--')).map(value => { const i = value.indexOf('='); return i < 0 ? [value.slice(2), true] : [value.slice(2, i), value.slice(i + 1)] }))
  const positional = args.filter(value => !value.startsWith('--'))
  const store = new RunStore()
  if (command === 'create') {
    const id = positional[0]
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new Error('Usage : persona create <id>')
    const path = join(PRIVATE_ROOT, 'personas', `${id}.json`)
    await access(path).then(() => { throw new Error('Ce persona existe déjà') }, () => {})
    const template = await readJson(join(ROOT, 'skills/persona/assets/persona.template.json'))
    template.id = id
    await store.write(path, template)
    console.log(path)
  } else if (command === 'validate') {
    if (!positional[0]) throw new Error('Chemin du persona requis')
    validatePersona(await readJson(positional[0]))
    console.log('Persona valide')
  } else if (command === 'start') {
    if (!positional[0]) throw new Error('Chemin du persona requis')
    const provider = flags.provider || 'playwright'
    console.log(await store.start(await readJson(positional[0]), provider))
  } else if (command === 'brief') {
    if (!positional[0]) throw new Error('Dossier d’essai requis')
    await store.load(positional[0])
    console.log(await readFile(join(positional[0], 'BRIEF.md'), 'utf8'))
  } else if (command === 'record' || command === 'finish') {
    const input = command === 'record' ? flags.event : flags.result
    if (!positional[0] || !input) throw new Error(`Usage : persona ${command} <dossier-essai> --${command === 'record' ? 'event' : 'result'}=<fichier.json>`)
    const value = await readJson(input)
    console.log(JSON.stringify(command === 'record' ? await store.record(resolve(positional[0]), value) : await store.finish(resolve(positional[0]), value), null, 2))
  } else if (command === 'compare') {
    console.log(await store.compare(positional.map(path => resolve(path))))
  } else if (command === 'browser') {
    if (!positional[0]) throw new Error('Dossier d’essai requis')
    const browser = new PersonaBrowser(store, resolve(positional[0]))
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
    try {
      console.log(JSON.stringify({ ready: true, observation: await browser.open({ headless: !!flags.headless }) }))
      for await (const line of lines) {
        if (!line.trim()) continue
        try {
          const action = JSON.parse(line)
          if (action.type === 'close') break
          console.log(JSON.stringify(await browser.act(action)))
        } catch (error) { console.log(JSON.stringify({ error: error.message })) }
      }
    } finally { lines.close(); await browser.close() }
  } else {
    console.log(`persona create <id>
persona validate <persona.json>
persona start <persona.json> --provider=${PROVIDERS.join('|')}
persona brief <dossier-essai>
persona browser <dossier-essai> [--headless]  # une action JSON par ligne sur stdin
persona record <dossier-essai> --event=<event.json>
persona finish <dossier-essai> --result=<result.json>
persona compare <dossier-essai> [autres-dossiers...]

Personas et résultats privés : ${PRIVATE_ROOT}
Le navigateur agit sur les décisions d’un agent ; ce programme ne choisit pas les actions à sa place.`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
