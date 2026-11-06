// Captures d'écran desktop + mobile, converties en WebP.
//
// Playwright ne sait pas écrire du WebP: on screenshote en PNG puis on convertit
// avec `cwebp` (Homebrew), et on supprime le PNG. 120 captures PNG pèsent 300 Mo,
// les mêmes en WebP q80 pèsent 30 Mo — la différence entre un repo qu'on peut
// versionner et un repo qu'on ne peut plus cloner.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, unlink, stat } from 'fs/promises'
import { join } from 'path'

const exec = promisify(execFile)

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

let cwebpAvailable = null

async function hasCwebp() {
  if (cwebpAvailable !== null) return cwebpAvailable
  try {
    await exec('cwebp', ['-version'])
    cwebpAvailable = true
  } catch {
    cwebpAvailable = false
  }
  return cwebpAvailable
}

// Bandeaux de consentement les plus répandus. On les masque plutôt que de cliquer
// partout: masquer ne déclenche aucun appel réseau et ne change rien côté site.
const CONSENT_SELECTORS = [
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '#usercentrics-root',
  '#CybotCookiebotDialog',
  '#cookiescript_injected',
  '.osano-cm-window',
  '.cc-window',
  '.cookie-banner',
  '[id*="cookie-banner"]',
  '[class*="cookie-consent"]',
  '[aria-label*="cookie" i][role="dialog"]',
  '[data-testid*="cookie" i]',
  '#hs-eu-cookie-confirmation',
  '.termly-styles-root',
  '#axeptio_overlay',
  '#tarteaucitronRoot',
]

const PREP_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  video, [data-teardown-hidden] { visibility: hidden !important; }
`

/**
 * Amène la page dans un état capturable: réseau calme, polices chargées,
 * animations gelées, contenu paresseux déclenché, bandeau cookies masqué.
 */
export async function preparePage(page, { settleMs = 600 } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})

  await page.addStyleTag({ content: PREP_CSS }).catch(() => {})

  await page
    .evaluate((selectors) => {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          el.setAttribute('data-teardown-hidden', '1')
          el.style.setProperty('display', 'none', 'important')
        }
      }
    }, CONSENT_SELECTORS)
    .catch(() => {})

  // Défilement par paliers pour déclencher les images et sections en lazy-load,
  // puis retour en haut pour que la capture parte du sommet de la page.
  await page
    .evaluate(async () => {
      const step = Math.max(window.innerHeight, 400)
      const max = Math.min(document.body.scrollHeight, 30000)
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 90))
      }
      window.scrollTo(0, 0)
      await new Promise((r) => setTimeout(r, 150))
    })
    .catch(() => {})

  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(settleMs)
}

export function slugify(input, fallback = 'page') {
  const s = String(input || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || fallback
}

export function slugForUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/|\/$/g, '')
    const query = u.search ? '-' + u.search.replace(/^\?/, '') : ''
    return slugify(path + query, 'home')
  } catch {
    return slugify(url)
  }
}

async function toWebp(pngPath, webpPath, quality) {
  if (!(await hasCwebp())) return null
  try {
    await exec('cwebp', ['-q', String(quality), '-quiet', pngPath, '-o', webpPath])
    await unlink(pngPath).catch(() => {})
    return webpPath
  } catch {
    return null
  }
}

/**
 * Capture un écran sur chaque viewport demandé.
 * Renvoie { desktop: 'screens/desktop/xx.webp', mobile: '…', bytes: n }.
 */
export async function captureScreens(page, {
  outDir,
  name,
  viewports = ['desktop', 'mobile'],
  quality = 80,
  fullPage = true,
  prepare = true,
  // Viewport déjà préparé par l'appelant. preparePage déroule toute la page pour
  // déclencher le lazy-load ; sur une landing de 6000 px, la refaire pour rien
  // double le coût de chaque écran.
  preparedFor = null,
}) {
  const shots = {}
  let bytes = 0

  for (const vp of viewports) {
    const size = VIEWPORTS[vp]
    if (!size) continue

    const dir = join(outDir, 'screens', vp)
    await mkdir(dir, { recursive: true })

    await page.setViewportSize(size).catch(() => {})
    if (prepare && vp !== preparedFor) await preparePage(page, { settleMs: vp === 'mobile' ? 800 : 600 })

    const pngPath = join(dir, `${name}.png`)
    const webpPath = join(dir, `${name}.webp`)

    try {
      await page.screenshot({ path: pngPath, fullPage, animations: 'disabled', scale: 'css' })
    } catch {
      // Pages démesurément longues: Chrome refuse le fullPage au-delà de ~16k px.
      try {
        await page.screenshot({ path: pngPath, fullPage: false, animations: 'disabled', scale: 'css' })
      } catch {
        continue
      }
    }

    const finalPath = (await toWebp(pngPath, webpPath, quality)) || pngPath
    const rel = `screens/${vp}/${finalPath.endsWith('.webp') ? name + '.webp' : name + '.png'}`
    shots[vp] = rel
    bytes += await stat(finalPath).then((s) => s.size).catch(() => 0)
  }

  // On repasse en desktop: le crawl continue et doit extraire les liens de la
  // version desktop, où la navigation n'est pas repliée dans un menu burger.
  await page.setViewportSize(VIEWPORTS.desktop).catch(() => {})

  return { ...shots, bytes }
}

export async function warnIfNoWebp(log) {
  if (!(await hasCwebp())) {
    log(
      'cwebp introuvable — captures gardées en PNG (repo beaucoup plus lourd). ' +
        'Installe-le avec: brew install webp'
    )
  }
}
