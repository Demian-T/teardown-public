// Découverte des pages d'un site: robots.txt, sitemap.xml, puis crawl en largeur
// des liens internes (y compris la sidebar de l'app une fois connecté, qui est la
// seule source d'URLs exploitable sur une SPA sans sitemap).

import { classify, normalizeUrl, urlPattern, priorityScore } from './classify.mjs'

// ── robots.txt ───────────────────────────────────────────────────────────────

function ruleToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp('^' + (escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped))
}

export function parseRobots(text) {
  const sitemaps = []
  const rules = [] // { allow: bool, pattern, re }
  // Des lignes User-agent consécutives forment UN groupe: "User-agent: *" suivi de
  // "User-agent: Bingbot" puis d'un Disallow s'applique aux deux. On ne retient que
  // les groupes qui contiennent l'agent générique.
  let starGroup = false
  let collectingAgents = false

  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (key === 'sitemap') {
      sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      if (!collectingAgents) {
        starGroup = false
        collectingAgents = true
      }
      if (value === '*') starGroup = true
      continue
    }
    if (key === 'disallow' || key === 'allow') {
      collectingAgents = false
      if (!starGroup) continue
      if (key === 'disallow' && value === '') continue // "Disallow:" vide = tout autorisé
      if (!value) continue
      rules.push({ allow: key === 'allow', pattern: value, re: ruleToRegex(value) })
    }
  }

  return { sitemaps, rules }
}

export function makeRobots(text) {
  const { sitemaps, rules } = parseRobots(text)

  // Règle la plus spécifique (la plus longue) gagne ; à longueur égale, Allow gagne.
  function isAllowed(pathname) {
    let best = null
    for (const r of rules) {
      if (!r.re.test(pathname)) continue
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
        best = r
      }
    }
    return best ? best.allow : true
  }

  const blockedPatterns = rules.filter((r) => !r.allow).map((r) => r.pattern)
  return { isAllowed, sitemaps, blockedPatterns, rules }
}

export async function fetchRobots(request, origin) {
  try {
    const res = await request.get(`${origin}/robots.txt`, { timeout: 15000 })
    if (!res.ok()) return makeRobots('')
    const body = await res.text()
    // Une SPA qui renvoie son index.html sur /robots.txt: on ignore.
    if (/<html/i.test(body.slice(0, 400))) return makeRobots('')
    return makeRobots(body)
  } catch {
    return makeRobots('')
  }
}

// ── sitemap.xml ──────────────────────────────────────────────────────────────

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&').trim()
  )
}

export async function collectSitemapUrls(request, seeds, { limit = 3000, maxSitemaps = 25 } = {}) {
  const queue = [...seeds]
  const seenSitemaps = new Set()
  const urls = new Set()

  while (queue.length && seenSitemaps.size < maxSitemaps && urls.size < limit) {
    const sm = queue.shift()
    if (!sm || seenSitemaps.has(sm)) continue
    seenSitemaps.add(sm)

    let xml
    try {
      const res = await request.get(sm, { timeout: 20000 })
      if (!res.ok()) continue
      xml = await res.text()
    } catch {
      continue
    }

    const isIndex = /<sitemapindex/i.test(xml)
    for (const loc of extractLocs(xml)) {
      if (isIndex) queue.push(loc)
      else if (urls.size < limit) urls.add(loc)
    }
  }

  return { urls: [...urls], sitemapsRead: [...seenSitemaps] }
}

// ── crawl ────────────────────────────────────────────────────────────────────

const LIMIT_PER_PATTERN = { capture: 2, sample: 2 }

function sameSite(url, host) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') === host
  } catch {
    return false
  }
}

// Une SPA renvoie 200 sur à peu près n'importe quelle URL: /app, /home et /console
// peuvent afficher trois fois le même écran de login sans que rien ne le signale
// côté HTTP. On compare donc ce qui est RENDU, pas ce qui est demandé.
export async function pageSignature(page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
      return {
        title: (document.title || '').trim(),
        h1: (document.querySelector('h1')?.innerText || '').trim(),
        textHead: text.slice(0, 400),
        textLen: text.length,
      }
    })
  } catch {
    return null
  }
}

function sameRender(a, b) {
  if (!a || !b) return false
  if (a.title !== b.title || a.h1 !== b.h1) return false
  return Math.abs(a.textLen - b.textLen) <= 40 && a.textHead.slice(0, 200) === b.textHead.slice(0, 200)
}

const LOGIN_RE = /\b(log ?in|sign ?in|continue with|se connecter|connexion|s'identifier|single sign-on)\b/i

// Un écran de login est court et parle de connexion. On le capture UNE fois (via la
// page /login légitime) et on écarte tous les murs rencontrés ailleurs.
function looksLikeLoginWall(sig) {
  return !!sig && sig.textLen < 800 && LOGIN_RE.test(sig.textHead)
}

export async function extractLinks(page) {
  try {
    return await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && !h.startsWith('#') && !h.startsWith('javascript:') && !h.startsWith('mailto:'))
    )
  } catch {
    return []
  }
}

/**
 * Parcours en largeur. `onPage` est appelé après le chargement et AVANT
 * l'extraction des liens: c'est lui qui fait défiler la page pour déclencher le
 * lazy-load, donc les liens récoltés ensuite incluent le contenu paresseux.
 *
 * onPage({ url, finalUrl, title, status, verdict, depth, page }) -> { captured: bool }
 */
export async function crawlSite({
  page,
  host,
  seeds,
  robots,
  ignoreRobots = false,
  maxPages = 60,
  maxDepth = 4,
  maxPerSection = 6,
  throttleMs = 1000,
  notFoundSignature = null,
  onPage,
  onSkip = () => {},
  log = () => {},
}) {
  // File de PRIORITÉ, pas file d'attente: on sort toujours l'URL la plus
  // prometteuse, quelle que soit sa profondeur.
  const frontier = seeds.map((url) => ({ url, depth: 0, score: priorityScore(url, 0) }))
  const takeNext = () => {
    if (!frontier.length) return null
    let best = 0
    for (let i = 1; i < frontier.length; i++) if (frontier[i].score < frontier[best].score) best = i
    return frontier.splice(best, 1)[0]
  }

  const visited = new Set()
  const patternCount = new Map()
  const sectionCount = new Map()
  const signatures = [] // { sig, url } des pages réellement capturées
  const pages = []
  const skipped = []
  const robotsBlocked = []
  let authWalls = 0
  let captured = 0

  const note = (url, reason, extra = {}) => {
    const entry = { url, reason, ...extra }
    skipped.push(entry)
    onSkip(entry)
  }

  while (frontier.length && captured < maxPages) {
    const { url, depth } = takeNext()
    if (visited.has(url)) continue
    visited.add(url)

    const verdict = classify(url)
    if (verdict.action === 'skip') {
      note(url, verdict.reason, { type: verdict.type })
      continue
    }
    if (verdict.action === 'index-only') {
      note(url, verdict.reason, { type: verdict.type })
      continue
    }

    let pathname
    try {
      pathname = new URL(url).pathname
    } catch {
      continue
    }

    const pattern = urlPattern(url)
    const segs = pathname.split('/').filter(Boolean)
    // Sur un listing, on plafonne par SECTION et pas par gabarit: /customers/ramp et
    // /customers/vercel ont des slugs trop courts pour être vus comme dynamiques, donc
    // chacun formerait son propre gabarit et la page clients passerait en entier.
    const section = '/' + (segs[0] || '') + '/*'
    const dedupKey = verdict.action === 'sample' ? section : pattern
    const seen = patternCount.get(dedupKey) || 0
    const limit = LIMIT_PER_PATTERN[verdict.action] ?? 2
    if (seen >= limit) {
      note(url, `gabarit déjà capturé (${dedupKey})`, { type: verdict.type, pattern })
      continue
    }

    // Garde-fou de diversité: même quand chaque page forme son propre gabarit, une
    // rubrique profonde (/method/*, /product/*) ne doit pas avaler tout le budget.
    // Ne mord que sur les chemins à plusieurs segments, donc jamais sur /pricing.
    if (verdict.action === 'capture' && segs.length >= 2) {
      const inSection = sectionCount.get(section) || 0
      if (inSection >= maxPerSection) {
        note(url, `section déjà couverte (${maxPerSection} écrans dans ${section})`, {
          type: verdict.type,
          section,
        })
        continue
      }
    }

    if (!ignoreRobots && !robots.isAllowed(pathname)) {
      robotsBlocked.push(url)
      note(url, 'bloqué par robots.txt', { type: verdict.type, robots: true })
      continue
    }

    let status = 0
    let finalUrl = url
    let headers = {}
    let navError = null

    // Deuxième chance avec un délai plus large. Une landing lourde dépasse parfois
    // 30 s sur un réseau qui hoquette, et abandonner au premier essai coûterait la
    // page d'accueil — celle dont tout le teardown dépend.
    for (const attempt of [1, 2]) {
      try {
        const res = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: attempt === 1 ? 30000 : 60000,
        })
        status = res ? res.status() : 0
        headers = res ? res.headers() : {}
        finalUrl = page.url()
        navError = null
        break
      } catch (err) {
        navError = err
        if (attempt === 1) await page.waitForTimeout(2000)
      }
    }
    if (navError) {
      note(url, `chargement impossible (${navError.message.split('\n')[0]})`, { type: verdict.type })
      continue
    }

    if (status >= 400) {
      note(url, `HTTP ${status}`, { type: verdict.type, status })
      continue
    }
    if (!sameSite(finalUrl, host)) {
      note(url, `redirigé hors site (${finalUrl})`, { type: verdict.type })
      continue
    }

    const normalizedFinal = normalizeUrl(finalUrl, url)
    if (normalizedFinal && normalizedFinal !== url) {
      if (visited.has(normalizedFinal)) {
        note(url, `redirige vers une page déjà vue`, { type: verdict.type })
        continue
      }
      visited.add(normalizedFinal)
      // Une redirection vers le login signifie qu'on n'est pas connecté sur cette zone.
      if (classify(normalizedFinal).type === 'auth' && verdict.type !== 'auth') {
        authWalls += 1
        note(url, 'redirigé vers le login (session absente sur cette zone)', {
          type: verdict.type,
          authWall: true,
        })
        continue
      }
    }

    // Laisser une SPA rendre: juste après domcontentloaded, le DOM d'une app React
    // est encore vide et toutes les pages se ressemblent.
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(800)

    const sig = await pageSignature(page)
    const isAuthPage = verdict.type === 'auth'

    if (sig && notFoundSignature && !isAuthPage && sameRender(sig, notFoundSignature)) {
      note(url, 'page inexistante rendue par la SPA (soft-404)', { type: verdict.type, softNotFound: true })
      continue
    }
    if (!isAuthPage && looksLikeLoginWall(sig)) {
      authWalls += 1
      note(url, 'mur de connexion — session absente sur cette zone', { type: verdict.type, authWall: true })
      continue
    }
    const twin = signatures.find((s) => sameRender(s.sig, sig))
    if (twin) {
      note(url, `rendu identique à ${twin.url}`, { type: verdict.type, duplicateOf: twin.url })
      continue
    }

    const title = sig?.title || (await page.title().catch(() => ''))
    patternCount.set(dedupKey, seen + 1)
    sectionCount.set(section, (sectionCount.get(section) || 0) + 1)
    signatures.push({ sig, url })

    const result =
      (await onPage({ url, finalUrl: normalizedFinal || finalUrl, title, status, headers, verdict, depth, page })) || {}
    // `links` est fourni par onPage quand il a relevé les liens pendant que la page
    // était encore en rendu desktop: sur mobile, la nav repliée dans un burger
    // disparaît parfois du DOM, et on perdrait la moitié de l'arborescence.
    const { links: providedLinks, captured: keep, ...record } = result
    if (keep !== false) {
      captured += 1
      pages.push({
        url: normalizedFinal || finalUrl,
        requestedUrl: url,
        title,
        type: verdict.type,
        pattern,
        depth,
        status,
        ...record,
      })
      log(`  [${captured}/${maxPages}] ${verdict.type.padEnd(14)} ${title.slice(0, 60) || url}`)
    }

    if (depth < maxDepth) {
      for (const href of providedLinks || (await extractLinks(page))) {
        const next = normalizeUrl(href, finalUrl)
        if (!next || visited.has(next) || !sameSite(next, host)) continue
        frontier.push({ url: next, depth: depth + 1, score: priorityScore(next, depth + 1) })
      }
    }

    if (throttleMs) await page.waitForTimeout(throttleMs)
  }

  return {
    pages,
    skipped,
    robotsBlocked,
    authWalls,
    visited: [...visited],
    // URLs dont on avait connaissance: celles examinées plus celles encore en file.
    known: visited.size + frontier.length,
  }
}
