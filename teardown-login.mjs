#!/usr/bin/env node
/**
 * Ouvre une session sur le produit à analyser, une fois par produit.
 *
 * Un vrai Chrome s'ouvre sur un profil dédié à ce domaine. Tu te connectes
 * dedans à la main (SSO, 2FA, magic link: peu importe, c'est un navigateur
 * normal). La session reste dans le profil, et `teardown.mjs` la réutilise à
 * chaque run suivant. Aucun mot de passe ne transite par le script.
 *
 * Usage: node teardown-login.mjs https://linear.app
 */

import { openSession, detectAuthState } from './lib/teardown/session.mjs'

async function main() {
  const raw = process.argv[2]
  if (!raw) {
    console.error('Usage: node teardown-login.mjs <url>')
    process.exit(1)
  }

  const target = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  const host = target.hostname.replace(/^www\./i, '')
  const origin = `${target.protocol}//${target.hostname}`

  const { page, close, profileDir } = await openSession({ host, headless: false })

  try {
    console.log(`Ouverture de ${origin} dans Chrome (profil ${profileDir})…`)
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(2500)

    if ((await detectAuthState(page)) === 'in') {
      console.log('Session déjà active ✓')
      return
    }

    console.log('\nConnecte-toi dans la fenêtre Chrome ouverte, puis navigue jusqu\'à ton tableau de bord.')
    process.stdout.write('Attente de connexion')

    let ok = false
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      if ((await detectAuthState(page)) === 'in') {
        ok = true
        break
      }
      process.stdout.write('.')
    }

    if (!ok) {
      console.log('\n\nToujours pas de signal de connexion après 6 min.')
      console.log('Ce n\'est pas forcément un échec: certains produits n\'exposent aucun lien')
      console.log('de déconnexion sur la page courante. Si tu es bien connecté dans la fenêtre,')
      console.log('la session est quand même enregistrée — lance le teardown, il explorera ce')
      console.log('qui répond.')
      return
    }
    console.log('\nConnecté ✓')
  } finally {
    await close()
    console.log(`\nSession enregistrée. Lance:\n  node teardown.mjs ${origin}`)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
