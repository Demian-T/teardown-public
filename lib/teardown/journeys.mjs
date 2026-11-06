// Reconstruit trois parcours à partir des pages crawlées, puis les rejoue dans
// l'ordre en capturant chaque étape.
//
// Règle absolue: rien n'est soumis, rien n'est créé, rien n'est supprimé. Les
// seules interactions autorisées ouvrent de l'interface déjà présente (menus,
// panneaux). L'ouverture d'une modale de création est derrière --try-create,
// parce que sur certains produits "Nouveau" crée l'objet au lieu d'ouvrir un
// formulaire, et on ne veut pas laisser de déchets dans les comptes de Demian.

import { captureScreens, slugify } from './capture.mjs'

const has = (re) => (p) => re.test(p.url)

function pick(pages, predicate, { exclude = new Set() } = {}) {
  const candidates = pages
    .filter((p) => !exclude.has(p.url) && predicate(p))
    .sort((a, b) => a.depth - b.depth || a.url.length - b.url.length)
  return candidates[0] || null
}

const isType = (...types) => (p) => types.includes(p.type)

export function planJourneys(pages) {
  const used = new Set()
  const take = (predicate) => {
    const found = pick(pages, predicate, { exclude: used })
    if (found) used.add(found.url)
    return found
  }

  const journeys = []

  // 1. Acquisition — ce que voit quelqu'un qui découvre le produit.
  const acquisition = [
    ['Arrivée', take(isType('home'))],
    ['Promesse produit', take(isType('product'))],
    ['Tarifs', take(isType('pricing'))],
    ['Écran d\'inscription', take((p) => p.type === 'auth' && /sign-?up|register|get-?started|inscri/i.test(p.url))],
    ['Écran de connexion', take((p) => p.type === 'auth')],
  ]
  journeys.push({ id: 'acquisition', label: 'Acquisition — de la découverte au compte', steps: acquisition })

  // 2. Cœur d'app — ce que voit un utilisateur connecté au quotidien.
  const appRoot = take(isType('app'))
  const app = [
    ['Entrée dans l\'app', appRoot],
    ['Navigation dépliée', appRoot ? { ...appRoot, action: 'navMenu' } : null],
    ['Vue de travail', take((p) => p.type === 'app' && (!appRoot || p.pattern !== appRoot.pattern))],
    ['Seconde vue', take((p) => p.type === 'app')],
  ]
  journeys.push({ id: 'app', label: 'Cœur d\'app — le quotidien de l\'utilisateur', steps: app })

  // 3. Compte — là où vivent profil, réglages et facturation.
  const account = [
    ['Menu utilisateur', appRoot ? { ...appRoot, action: 'userMenu' } : null],
    ['Profil', take(isType('profile'))],
    ['Réglages', take(isType('settings'))],
    ['Équipe', take(isType('team'))],
    ['Facturation', take(isType('billing'))],
  ]
  journeys.push({ id: 'compte', label: 'Compte — profil, réglages, facturation', steps: account })

  return journeys
    .map((j) => ({
      ...j,
      steps: j.steps.filter(([, p]) => p).map(([role, p]) => ({ role, ...p })),
    }))
    .filter((j) => j.steps.length >= 2)
}

// ── interactions sûres ───────────────────────────────────────────────────────

const MENU_LABEL = /\b(account|profile|profil|compte|user|utilisateur|avatar|settings|réglages|menu|more|plus)\b/i
const NAV_LABEL = /\b(menu|navigation|nav|sidebar|open menu|toggle)\b/i
const CREATE_LABEL = /^(\+|new|create|add|nouveau|nouvelle|créer|ajouter)\b/i

async function clickFirstMatching(page, labelRe, { requireOverlay = true } = {}) {
  const before = page.url()
  const handles = await page.$$('button, [role="button"], [aria-haspopup], summary').catch(() => [])

  for (const el of handles.slice(0, 120)) {
    let label = ''
    try {
      const visible = await el.isVisible()
      if (!visible) continue
      label =
        (await el.getAttribute('aria-label')) ||
        (await el.getAttribute('title')) ||
        (await el.innerText().catch(() => '')) ||
        ''
      label = label.trim()
      if (!label || label.length > 40 || !labelRe.test(label)) continue
      await el.click({ timeout: 3000 })
    } catch {
      continue
    }

    await page.waitForTimeout(700)

    if (page.url() !== before) {
      // Le bouton était en fait un lien: ce n'est pas l'ouverture d'un panneau,
      // mais ce n'est pas destructeur non plus. On revient en arrière.
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForTimeout(400)
      continue
    }

    if (!requireOverlay) return { opened: true, label }
    const overlay = await page
      .evaluate(
        () => !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"], [data-state="open"], dialog[open]')
      )
      .catch(() => false)
    if (overlay) return { opened: true, label }
  }
  return { opened: false, label: null }
}

async function dismiss(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
}

const ACTIONS = {
  async userMenu(page) {
    const r = await clickFirstMatching(page, MENU_LABEL)
    return r.opened ? { note: `menu utilisateur ouvert via "${r.label}"` } : null
  },
  async navMenu(page) {
    const r = await clickFirstMatching(page, NAV_LABEL, { requireOverlay: false })
    return r.opened ? { note: `navigation ouverte via "${r.label}"` } : null
  },
  async createModal(page) {
    const before = page.url()
    const r = await clickFirstMatching(page, CREATE_LABEL)
    if (!r.opened) return null
    if (page.url() !== before) return { note: 'création déclenchée — étape abandonnée', aborted: true }
    return { note: `modale de création ouverte via "${r.label}"` }
  },
}

// ── exécution ────────────────────────────────────────────────────────────────

export async function walkJourneys({
  page,
  journeys,
  outDir,
  viewports,
  quality,
  capturedByUrl = new Map(),
  tryCreate = false,
  throttleMs = 800,
  log = () => {},
}) {
  const out = []

  for (const journey of journeys) {
    log(`\n  ${journey.label}`)
    const steps = []
    let index = 0

    for (const step of journey.steps) {
      index += 1
      const action = step.action && (step.action !== 'createModal' || tryCreate) ? step.action : null

      // Sans interaction, la capture du crawl fait l'affaire: on ne recharge pas
      // la page pour rien.
      if (!action && capturedByUrl.has(step.url)) {
        const shots = capturedByUrl.get(step.url)
        steps.push({ ...stripInternal(step), order: index, shots, reused: true })
        log(`    ${index}. ${step.role} — ${step.url}`)
        continue
      }

      try {
        await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } catch {
        log(`    ${index}. ${step.role} — inaccessible, étape ignorée`)
        continue
      }

      let note = null
      if (action) {
        const result = await ACTIONS[action](page).catch(() => null)
        if (!result) {
          log(`    ${index}. ${step.role} — interaction introuvable, étape ignorée`)
          continue
        }
        if (result.aborted) {
          log(`    ${index}. ${step.role} — ${result.note}`)
          continue
        }
        note = result.note
      }

      const name = `journey-${journey.id}-${String(index).padStart(2, '0')}-${slugify(step.role)}`
      const shots = await captureScreens(page, { outDir, name, viewports, quality })
      if (action) await dismiss(page)

      steps.push({ ...stripInternal(step), order: index, action, note, shots })
      log(`    ${index}. ${step.role}${note ? ` (${note})` : ''}`)
      await page.waitForTimeout(throttleMs)
    }

    if (steps.length >= 2) out.push({ ...journey, steps })
  }

  return out
}

function stripInternal({ role, url, title, type, pattern }) {
  return { role, url, title, type, pattern }
}
