// Tient à jour les deux fichiers transverses de output/:
//
//   INDEX.md     — un teardown par ligne, pour retrouver ce qui a déjà été analysé
//   PATTERNS.md  — la bibliothèque thématique, remplie par l'agent en phase 2
//
// Le script ne fait qu'entretenir la structure et la ligne d'index. Le contenu
// analytique de PATTERNS.md est écrit par l'agent, qui est le seul à savoir lire
// un screenshot.

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

const INDEX_HEADER = `# Teardowns

Analyses de produits: arborescence réelle, parcours utilisateur, patterns d'interface,
stack et design tokens. Un dossier par produit et par date, généré par \`/teardown\`.

Pour piocher par thème plutôt que par produit, ouvrir [PATTERNS.md](PATTERNS.md).

| Produit | Date | Écrans | Parcours | Stack | Rapport | Galerie |
|---|---|---|---|---|---|---|
`

const PATTERNS_HEADER = `# Bibliothèque de patterns

Agrégée à partir de tous les teardowns de ce dossier. Chaque entrée pointe vers le
produit qui l'utilise et vers la capture correspondante.

À consulter au moment de dessiner un écran, pas au moment de le coder.

`

const PATTERN_SECTIONS = [
  'Onboarding & activation',
  'Navigation & architecture',
  'Pricing & packaging',
  'Empty states',
  'Paywall & limites du plan',
  'Formulaires & saisie',
  'Réglages & compte',
  'Copy & microcopy',
]

async function readOr(path, fallback) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return fallback
  }
}

export async function ensureLibrary(rootDir) {
  await mkdir(rootDir, { recursive: true })

  const patternsPath = join(rootDir, 'PATTERNS.md')
  const existing = await readOr(patternsPath, null)
  if (existing === null) {
    const body = PATTERNS_HEADER + PATTERN_SECTIONS.map((s) => `## ${s}\n\n_Rien encore._\n`).join('\n')
    await writeFile(patternsPath, body, 'utf8')
  }
}

/**
 * Insère ou remplace la ligne d'index de ce teardown. Relancer un teardown le
 * même jour sur le même produit met la ligne à jour au lieu de la dupliquer.
 */
export async function upsertIndexRow(rootDir, row) {
  const indexPath = join(rootDir, 'INDEX.md')
  const current = await readOr(indexPath, INDEX_HEADER)

  const dir = `${row.host}/${row.date}`
  const cells = [
    row.host,
    row.date,
    String(row.screens),
    String(row.journeys),
    (row.stack || []).slice(0, 3).join(' · ') || '—',
    `[rapport](${dir}/README.md)`,
    `[galerie](${dir}/index.html)`,
  ]
  const line = `| ${cells.join(' | ')} |`

  const lines = current.split('\n')
  const rowStart = lines.findIndex((l) => /^\|\s*-+/.test(l.replace(/\s/g, '')) || /^\|---/.test(l))
  const headerEnd = rowStart === -1 ? lines.length : rowStart + 1

  const head = lines.slice(0, headerEnd)
  const body = lines
    .slice(headerEnd)
    .filter((l) => l.trim() && !l.includes(`(${dir}/README.md)`))

  body.unshift(line)
  // Les teardowns les plus récents en haut: c'est l'ordre dans lequel on les cherche.
  body.sort((a, b) => {
    const da = (a.split('|')[2] || '').trim()
    const db = (b.split('|')[2] || '').trim()
    return db.localeCompare(da)
  })

  await writeFile(indexPath, [...head, ...body, ''].join('\n'), 'utf8')
}
