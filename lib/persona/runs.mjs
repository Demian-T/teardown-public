import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises'
import { resolve, join, relative, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PROVIDERS, validatePersona, validateEvent, validateResult } from './model.mjs'
import { renderRun, renderComparison } from './report.mjs'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const PRIVATE_ROOT = join(ROOT, '.local/persona')
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const inside = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)) }

export class RunStore {
  constructor(root = PRIVATE_ROOT) { this.root = resolve(root) }

  async privatePath(path) {
    const destination = resolve(path)
    if (!inside(this.root, destination)) throw new Error('Les fichiers persona doivent rester dans le dossier privé .local/persona')
    await mkdir(this.root, { recursive: true })
    await mkdir(dirname(destination), { recursive: true })
    if (!inside(await realpath(this.root), await realpath(dirname(destination)))) throw new Error('Lien symbolique sortant du dossier privé')
    try {
      if (!inside(await realpath(this.root), await realpath(destination))) throw new Error('Lien symbolique sortant du dossier privé')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return destination
  }

  async write(path, value) {
    path = await this.privatePath(path)
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temporary, path)
  }

  async load(directory) {
    const path = await this.privatePath(join(resolve(directory), 'run.json'))
    const run = await readJson(path)
    validatePersona(run.persona)
    return run
  }

  async save(directory, run) {
    await this.write(join(directory, 'run.json'), run)
    await this.write(join(directory, 'index.html'), renderRun(run))
  }

  async start(persona, provider) {
    validatePersona(persona)
    if (!PROVIDERS.includes(provider)) throw new Error(`Provider : ${PROVIDERS.join(', ')}`)
    const startedAt = new Date().toISOString()
    const directory = join(this.root, 'runs', `${startedAt.replace(/[:.]/g, '-')}-${persona.id}-${randomUUID().slice(0, 8)}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const run = { schemaVersion: 1, id: randomUUID(), provider, startedAt, status: 'running', persona: structuredClone(persona), events: [] }
    await this.save(directory, run)
    await this.write(join(directory, 'BRIEF.md'), buildBrief(run, directory))
    return directory
  }

  async record(directory, event) {
    const run = await this.load(directory)
    validateEvent(event, run)
    for (const observation of [event.before, event.after]) {
      if (observation.screenshot) {
        if (isAbsolute(observation.screenshot)) throw new Error('La capture doit avoir un chemin relatif au dossier d’essai')
        const path = await this.privatePath(resolve(directory, observation.screenshot))
        if (!inside(resolve(directory), path) || !(await stat(path)).isFile()) throw new Error('Capture locale absente du dossier de cet essai')
      }
    }
    run.events.push({ ...event, sequence: run.events.length + 1, recordedAt: new Date().toISOString(), provider: run.provider })
    await this.save(directory, run)
    return run.events.at(-1)
  }

  async finish(directory, result) {
    const run = await this.load(directory)
    validateResult(result, run)
    run.result = result
    run.status = 'finished'
    run.finishedAt = new Date().toISOString()
    run.automationDurationSeconds = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)
    await this.save(directory, run)
    return run
  }

  async compare(directories) {
    if (!directories.length) throw new Error('Au moins un dossier d’essai requis')
    const runs = []
    for (const directory of directories) runs.push({ run: await this.load(directory), directory: resolve(directory) })
    const directory = join(this.root, 'comparisons', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
    await this.write(join(directory, 'index.html'), renderComparison(runs, directory))
    return directory
  }
}

export function buildBrief(run, directory) {
  return `# Parcours persona — ${run.persona.name}

Provider choisi : ${run.provider}. Dossier privé de l’essai : ${directory}

Simule ce persona depuis l’URL de départ. Décide une action à la fois d’après ce qui est réellement visible. Ne suis pas un chemin pré-écrit et ne consulte ni sitemap, ni code source, ni résultats d’un autre persona. Le persona décrit des hypothèses : n’invente pas une capacité, une peur ou une préférence à partir de l’âge ou du genre.

Lis les instructions skills/persona/SKILL.md et, pour un agent externe, skills/persona/references/browser-adapters.md. Avec Claude in Chrome, Aside ou un autre navigateur, utilise les outils disponibles, pas des noms de commandes supposés. Si ce brief est collé hors du dépôt, les règles ci-dessous suffisent pour effectuer le parcours ; demande ensuite à l’agent local d’importer les observations.

## Contrat de navigation

- Commence sur scenario.startUrl. Reste dans scenario.allowedOrigins ; un lien extérieur marque une limite à consigner, pas une permission de poursuivre.
- Respecte la lecture, les critères de choix et la méthode de récupération du persona. Fais défiler la page pour découvrir le contenu hors écran. Ne clique pas directement sur une cible encore hors écran.
- Chaque étape conserve l’écran avant et après, l’action, sa raison liée au persona, l’attente, le texte réellement observé et le résultat. Utilise des captures locales ou des références de capture de l’outil.
- Pas de soumission de formulaire, d’achat, d’inscription, de message, de création ou de suppression. La saisie seule dépend de allowFormInput. Arrête-toi avant une validation et distingue intention, formulaire atteint et transaction réalisée.
- Arrête-toi quand les critères sont remplis, le budget est épuisé ou une limite est rencontrée. N’invente ni réaction émotionnelle observée ni durée humaine. Les temps mesurés sont ceux de l’agent.
- Pour chaque critère, cite les étapes et une preuve observable. Les statuts possibles sont success, partial, blocked et abandoned ; success exige tous les critères remplis.

## Persona et scénario figés pour cet essai

\`\`\`json
${JSON.stringify(run.persona, null, 2)}
\`\`\`

## Enregistrement externe

Après chaque action réelle, produire un objet JSON avec action {type, reason, expectation, label}, before et after {url, text, screenshot OU captureRef}, status (ok, failed ou boundary). Les captures screenshot sont des chemins relatifs dans le dossier privé de cet essai. Ne pas inventer une capture. Garder les références d’outil quand l’outil ne fournit pas de fichier.

À la fin, produire {outcome, summary, criteria:[{id, met, evidence, eventSequences:[1]}]}. Un critère non rempli reste met:false, y compris lorsqu’une information n’est pas trouvée.
`
}
