#!/usr/bin/env node
/**
 * /teardown — phase 1: crawl, captures, extraction.
 *
 * Cartographie un produit web (vitrine ET intérieur de l'app si la session est
 * ouverte), capture chaque écran significatif en desktop et mobile, reconstitue
 * les parcours utilisateur, relève la stack et les design tokens.
 *
 * Rien n'est soumis, créé ni supprimé sur le site analysé.
 *
 * Usage:
 *   node teardown.mjs https://linear.app
 *   node teardown.mjs https://linear.app --mode=quick
 *   node teardown.mjs https://linear.app --max-pages=100 --ignore-robots
 *
 * Session: node teardown-login.mjs https://linear.app  (une fois par produit)
 */

import { mkdir, writeFile, stat } from 'fs/promises'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

import { openSession, detectAuthState, APP_ENTRY_PATHS, profileDirFor } from './lib/teardown/session.mjs'
import { fetchRobots, collectSitemapUrls, crawlSite, extractLinks, pageSignature } from './lib/teardown/discover.mjs'
import { normalizeUrl, pageType, priorityScore } from './lib/teardown/classify.mjs'
import { captureScreens, preparePage, slugForUrl, warnIfNoWebp } from './lib/teardown/capture.mjs'
import { fingerprintPage, mergeFingerprints } from './lib/teardown/fingerprint.mjs'
import { planJourneys, walkJourneys } from './lib/teardown/journeys.mjs'
import { writeGallery } from './lib/teardown/gallery.mjs'
import { ensureLibrary, upsertIndexRow } from './lib/teardown/library.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const TEARDOWNS_DIR = join(ROOT, 'output')

const MODES = {
  quick: { maxPages: 25, maxDepth: 3, throttleMs: 700 },
  standard: { maxPages: 60, maxDepth: 4, throttleMs: 1000 },
  full: { maxPages: 150, maxDepth: 5, throttleMs: 1000 },
}

const log = (msg = '') => console.log(msg)

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      flags[key] = value === undefined ? true : value
    } else positional.push(arg)
  }
  return { url: positional[0], flags }
}

async function main() {
  const { url: rawUrl, flags } = parseArgs(process.argv.slice(2))
  if (!rawUrl) {
    console.error('Usage: node teardown.mjs <url> [--mode=quick|standard|full] [--max-pages=N] [--ignore-robots] [--try-create] [--no-mobile] [--headless]')
    process.exit(1)
  }

  const target = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  const host = target.hostname.replace(/^www\./i, '')
  const origin = `${target.protocol}//${target.hostname}`

  const mode = MODES[flags.mode] || MODES.standard
  const maxPages = Number(flags['max-pages']) || mode.maxPages
  const maxDepth = Number(flags.depth) || mode.maxDepth
  const ignoreRobots = !!flags['ignore-robots']
  const tryCreate = !!flags['try-create']
  const quality = Number(flags.quality) || 80
  const viewports = flags['no-mobile'] ? ['desktop'] : ['desktop', 'mobile']

  const date = new Date().toISOString().slice(0, 10)
  const outDir = join(TEARDOWNS_DIR, host, date)
  await mkdir(outDir, { recursive: true })
  await ensureLibrary(TEARDOWNS_DIR)
  await warnIfNoWebp((m) => log(`! ${m}`))

  log(`\nTeardown ${host} — mode ${flags.mode || 'standard'} (${maxPages} écrans max, profondeur ${maxDepth})`)
  log(`Sortie: ${relative(ROOT, outDir)}\n`)

  const { context, page, close } = await openSession({ host, headless: !!flags.headless })
  const startedAt = Date.now()

  try {
    // ── session ──────────────────────────────────────────────────────────────
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const auth = await detectAuthState(page)
    log(
      auth === 'in'
        ? 'Session: connecté ✓ — l\'intérieur de l\'app sera exploré'
        : auth === 'out'
          ? `Session: non connecté — vitrine seulement. Pour explorer l'app:\n  node teardown-login.mjs ${origin}`
          : 'Session: état indéterminé — on explore ce qui répond'
    )

    // ── découverte ───────────────────────────────────────────────────────────
    const robots = await fetchRobots(context.request, origin)
    const sitemapSeeds = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`]
    const { urls: sitemapUrls, sitemapsRead } = await collectSitemapUrls(context.request, sitemapSeeds)
    log(`robots.txt: ${robots.rules.length} règles, ${robots.sitemaps.length} sitemaps déclarés`)
    log(`sitemap: ${sitemapUrls.length} URLs depuis ${sitemapsRead.length} fichier(s)`)

    const seedSet = new Set()
    const addSeed = (u) => {
      const n = normalizeUrl(u, origin)
      if (n && new URL(n).hostname.replace(/^www\./i, '') === host) seedSet.add(n)
    }
    addSeed(origin)
    for (const p of APP_ENTRY_PATHS) addSeed(origin + p)
    for (const u of sitemapUrls) addSeed(u)

    const seeds = [...seedSet].sort((a, b) => priorityScore(a) - priorityScore(b) || a.length - b.length)
    log(`amorces: ${seeds.length} URLs`)

    // Sonde: à quoi ressemble une URL qui n'existe pas ? Beaucoup de SPA répondent
    // 200 partout, souvent avec leur écran de login. Sans cette empreinte, /app,
    // /home et /console se font capturer trois fois comme s'il s'agissait de pages
    // différentes, et le budget part en fumée.
    let notFoundSignature = null
    try {
      await page.goto(`${origin}/teardown-probe-${Date.now().toString(36)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      })
      await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(800)
      notFoundSignature = await pageSignature(page)
      if (notFoundSignature) log(`sonde 404: "${(notFoundSignature.title || '(sans titre)').slice(0, 50)}"`)
    } catch {
      log('sonde 404: pas de réponse, détection des soft-404 désactivée')
    }
    log('')

    // ── crawl + captures ─────────────────────────────────────────────────────
    const fingerprints = []
    const capturedByUrl = new Map()
    let order = 0

    const { pages, skipped, robotsBlocked, authWalls, known } = await crawlSite({
      page,
      host,
      seeds,
      robots,
      ignoreRobots,
      maxPages,
      maxDepth,
      throttleMs: mode.throttleMs,
      notFoundSignature,
      log,
      onPage: async ({ url, title, headers, verdict, page }) => {
        order += 1

        // Préparation en desktop d'abord: on relève les liens sur cette version,
        // avant toute bascule mobile.
        await preparePage(page)
        const links = await extractLinks(page)

        // La vitrine et l'app sont souvent deux stacks différentes: un site
        // statique devant, une SPA derrière. L'écran de connexion appartient déjà
        // à la seconde, c'est le seul morceau d'app visible sans être connecté.
        if (fingerprints.length < 4 && ['home', 'app', 'pricing', 'auth'].includes(verdict.type)) {
          const fp = await fingerprintPage(page, { headers })
          if (fp) fingerprints.push(fp)
        }

        const name = `${String(order).padStart(3, '0')}-${slugForUrl(url)}`
        const shots = await captureScreens(page, { outDir, name, viewports, quality, preparedFor: 'desktop' })
        capturedByUrl.set(url, shots)

        return { shots, links, name }
      },
    })

    // ── parcours ─────────────────────────────────────────────────────────────
    log('\nParcours utilisateur')
    const planned = planJourneys(pages)
    const journeys = await walkJourneys({
      page,
      journeys: planned,
      outDir,
      viewports,
      quality,
      capturedByUrl,
      tryCreate,
      log,
    })

    // ── sorties ──────────────────────────────────────────────────────────────
    const fingerprint = mergeFingerprints(fingerprints)
    const durationMin = Math.round((Date.now() - startedAt) / 60000)
    const bytes = pages.reduce((n, p) => n + (p.shots?.bytes || 0), 0)

    const stats = {
      captured: pages.length,
      discovered: known,
      skipped: skipped.length,
      robotsBlocked: robotsBlocked.length,
      authWalls,
      journeys: journeys.length,
      durationMin,
      megabytes: Math.round((bytes / 1e6) * 10) / 10,
    }

    const sitemap = {
      host,
      origin,
      date,
      generatedAt: new Date().toISOString(),
      mode: flags.mode || 'standard',
      auth,
      options: { maxPages, maxDepth, ignoreRobots, tryCreate, viewports, quality },
      stats,
      pages: pages.map((p) => ({
        url: p.url,
        title: p.title,
        type: p.type,
        pattern: p.pattern,
        depth: p.depth,
        shots: { desktop: p.shots?.desktop || null, mobile: p.shots?.mobile || null },
      })),
      skipped,
      robotsBlocked,
    }

    // README d'attente: l'index pointe dessus dès la fin du crawl, et l'analyse
    // n'arrive qu'en phase 2. Sans ça, un teardown laissé en plan laisse un lien
    // mort dans INDEX.md. L'agent écrase ce fichier quand il rédige.
    const readmePath = join(outDir, 'README.md')
    const readmeExists = await stat(readmePath).then(() => true).catch(() => false)
    if (!readmeExists) {
      await writeFile(
        readmePath,
        [
          `# Teardown — ${host}`,
          '',
          `${date}. ${stats.captured} écrans capturés, ${stats.journeys} parcours reconstitués, mode ${flags.mode || 'standard'}.`,
          `Galerie: [index.html](index.html)`,
          '',
          '## Analyse non rédigée',
          '',
          'Le crawl est fait, les données sont là, mais personne ne les a encore lues.',
          'Pour produire l\'analyse, lancer le skill `/teardown` et demander la phase 2',
          'sur ce dossier.',
          '',
          `Données brutes: \`sitemap.json\`, \`journeys.json\`, \`fingerprint.json\`.`,
          '',
        ].join('\n'),
        'utf8'
      )
    }

    await writeFile(join(outDir, 'sitemap.json'), JSON.stringify(sitemap, null, 2))
    await writeFile(join(outDir, 'journeys.json'), JSON.stringify({ host, date, journeys }, null, 2))
    await writeFile(join(outDir, 'fingerprint.json'), JSON.stringify(fingerprint, null, 2))
    await writeGallery(outDir, { host, date, pages, journeys, fingerprint, stats })
    await upsertIndexRow(TEARDOWNS_DIR, {
      host,
      date,
      screens: pages.length,
      journeys: journeys.length,
      stack: [...(fingerprint?.framework || []), ...(fingerprint?.css || [])],
    })

    // ── résumé ───────────────────────────────────────────────────────────────
    log(`\n${'─'.repeat(64)}`)
    log(`${stats.captured} écrans · ${stats.journeys} parcours · ${stats.megabytes} Mo · ${durationMin} min`)
    log(`${stats.discovered} URLs connues, ${stats.skipped} écartées (juridique, blog, docs, gabarits et rendus dupliqués)`)
    if (authWalls) {
      log(`${authWalls} pages derrière un mur de connexion — pour les explorer :`)
      log(`  node teardown-login.mjs ${origin}   puis relance le teardown`)
    }
    if (fingerprint) {
      const stack = [...fingerprint.framework, ...fingerprint.css, ...fingerprint.hosting].slice(0, 6)
      if (stack.length) log(`stack: ${stack.join(' · ')}`)
      if (fingerprint.thirdParties.length)
        log(`tiers: ${fingerprint.thirdParties.map((t) => t.name).slice(0, 8).join(' · ')}`)
    }
    if (robotsBlocked.length) {
      log('')
      log(`! ${robotsBlocked.length} URLs écartées par robots.txt, dont:`)
      for (const u of robotsBlocked.slice(0, 5)) log(`    ${u}`)
      const appBlocked = robotsBlocked.filter((u) => ['app', 'settings', 'profile', 'billing', 'team'].includes(pageType(u)))
      if (appBlocked.length && !ignoreRobots) {
        log(`  ${appBlocked.length} concernent l'intérieur de l'app, où tu es un utilisateur connecté légitime.`)
        log(`  Pour les inclure: node teardown.mjs ${origin} --ignore-robots`)
      }
    }
    log('')
    log(`Galerie: ${join(relative(ROOT, outDir), 'index.html')}`)
    log(`Données: sitemap.json · journeys.json · fingerprint.json`)
    log(`Profil Chrome: ${relative(ROOT, profileDirFor(host))}`)
    log(`${'─'.repeat(64)}\n`)
  } finally {
    await close()
  }
}

main().catch((err) => {
  console.error(`\nÉchec: ${err.message}`)
  process.exit(1)
})
