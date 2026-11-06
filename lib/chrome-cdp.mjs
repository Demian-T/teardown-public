// Lance un VRAI Google Chrome "propre" (sans les flags d'automation de Playwright,
// que LinkedIn détecte : --enable-automation, navigator.webdriver) puis s'y attache
// via CDP. C'est la seule façon fiable de piloter une session LinkedIn : le navigateur
// est indiscernable d'un Chrome normal, et on réutilise un profil persistant connecté.
import { spawn } from 'child_process'
import { createServer } from 'net'
import { rm } from 'fs/promises'
import { join } from 'path'
import { chromium } from 'playwright'

const CHROME_BIN =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForCDP(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Chrome CDP indisponible (le navigateur ne répond pas)')
}

// Ouvre Chrome sur `profileDir` et renvoie { browser, context, close }.
// `headless: false` recommandé — LinkedIn bounce souvent le mode headless.
export async function launchChromeCDP({ profileDir, headless = false, extraArgs = [] }) {
  // Un lock résiduel d'un Chrome précédent empêcherait l'ouverture du profil.
  await rm(join(profileDir, 'SingletonLock'), { force: true }).catch(() => {})

  const port = await freePort()
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    ...extraArgs,
    'about:blank',
  ]
  if (headless) args.unshift('--headless=new')

  const proc = spawn(CHROME_BIN, args, { stdio: 'ignore' })
  await waitForCDP(port)

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0] || (await browser.newContext())

  const close = async () => {
    try { await browser.close() } catch { /* déjà fermé */ }
    try { proc.kill('SIGTERM') } catch { /* déjà mort */ }
  }
  return { browser, context, close }
}
