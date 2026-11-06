// Session navigateur pour /teardown.
//
// Un profil Chrome persistant PAR DOMAINE analysé: rester connecté sur linear.app
// n'interfère pas avec la session notion.so, et on peut accumuler des sessions sur
// dix produits sans jamais les faire se marcher dessus.
//
// On passe par un vrai Chrome (chrome-cdp.mjs) et pas par le Chromium de Playwright:
// les SaaS derrière Cloudflare bouncent le second, pas le premier.

import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { launchChromeCDP } from '../chrome-cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROFILES_ROOT = join(__dirname, '../../.cookies/teardown')

export function profileDirFor(host) {
  return join(PROFILES_ROOT, host.replace(/[^a-z0-9.-]/gi, '_'))
}

export async function openSession({ host, headless = false }) {
  const profileDir = profileDirFor(host)
  await mkdir(profileDir, { recursive: true })

  const { browser, context, close } = await launchChromeCDP({ profileDir, headless })
  const page = context.pages()[0] || (await context.newPage())
  // Chrome attaché par CDP n'a pas de viewport Playwright: on le pose explicitement
  // pour que les captures desktop soient reproductibles d'un run à l'autre.
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})

  return { browser, context, page, close, profileDir }
}

// Renvoie 'in' | 'out' | 'unknown'. Volontairement conservateur: on ne déclare
// "connecté" que sur un signal fort (un lien de déconnexion), parce qu'un faux
// positif ferait crawler la vitrine en croyant explorer l'app.
export async function detectAuthState(page) {
  try {
    return await page.evaluate(() => {
      const OUT_TEXT = /\b(log ?out|sign ?out|déconnexion|se déconnecter|logout|signout)\b/i
      const OUT_HREF = /(logout|log-out|signout|sign-out|deconnexion|sessions\/destroy)/i
      const IN_TEXT = /^(sign in|log in|login|se connecter|connexion|sign up|s'inscrire)/i
      const IN_HREF = /\/(login|signin|sign-in|sign_in|auth\/login|users\/sign_in|connexion)(\/|$|\?)/i

      let strongIn = false
      let strongOut = false

      for (const el of document.querySelectorAll('a[href], button, [role="menuitem"]')) {
        const href = el.getAttribute('href') || ''
        const text = (el.textContent || '').trim().slice(0, 60)
        const label = el.getAttribute('aria-label') || ''
        if (OUT_HREF.test(href) || OUT_TEXT.test(text) || OUT_TEXT.test(label)) strongIn = true
        if (IN_HREF.test(href) && IN_TEXT.test(text)) strongOut = true
      }

      if (strongIn) return 'in'
      if (strongOut) return 'out'
      return 'unknown'
    })
  } catch {
    return 'unknown'
  }
}

// Chemins d'entrée d'app les plus courants. Sert à trouver la racine applicative
// d'une SPA, qui par construction n'apparaît jamais dans le sitemap.xml.
export const APP_ENTRY_PATHS = [
  '/app',
  '/dashboard',
  '/home',
  '/workspace',
  '/console',
  '/admin',
  '/account',
  '/projects',
  '/my',
]
