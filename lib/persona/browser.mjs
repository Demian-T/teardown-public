import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { launchChromeCDP } from '../chrome-cdp.mjs'
import { assertBudget, assertSafeClick, inScope, ACTIONS } from './model.mjs'

export class PersonaBrowser {
  constructor(store, directory) { this.store = store; this.directory = directory; this.frame = 0 }

  async open({ headless = false } = {}) {
    this.run = await this.store.load(this.directory)
    if (this.run.provider !== 'playwright') throw new Error('Le navigateur local exige provider=playwright')
    assertBudget(this.run)
    const startedAt = new Date().toISOString()
    if (this.run.events.length) throw new Error('Créer un nouvel essai pour une session navigateur neuve ; les reprises ne rejouent pas les actions')
    const profileDir = await this.store.privatePath(join(this.directory, 'profile'))
    await mkdir(profileDir, { recursive: true, mode: 0o700 })
    this.session = await launchChromeCDP({ profileDir, headless })
    try {
      this.page = this.session.context.pages()[0] || await this.session.context.newPage()
      this.knownPages = new Set(this.session.context.pages())
      const mobile = this.run.persona.scenario.device === 'mobile'
      this.viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
      await this.page.setViewportSize(this.viewport)
      await this.page.goto(this.run.persona.scenario.startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await this.page.waitForLoadState('load', { timeout: 8000 }).catch(() => {})
      this.current = await this.observe()
      const status = inScope(this.current.url, this.run.persona) ? 'ok' : 'boundary'
      await this.store.record(this.directory, { startedAt, action: { type: 'observe', requestedUrl: this.run.persona.scenario.startUrl, reason: 'Arrivée sur l’URL de départ du scénario', expectation: this.run.persona.goal }, before: this.current, after: this.current, status })
      return this.current
    } catch (error) { await this.close(); throw error }
  }

  async observe() {
    const popup = this.session.context.pages().find(page => !this.knownPages.has(page))
    if (popup) {
      await popup.waitForURL(url => ['http:', 'https:'].includes(url.protocol), { timeout: 5000 }).catch(() => {})
      if (popup.url() !== 'about:blank') {
        this.knownPages.add(popup)
        this.page = popup
        await this.page.setViewportSize(this.viewport)
      }
    }
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    const screenshot = `screens/${String(++this.frame).padStart(3, '0')}.png`
    const destination = await this.store.privatePath(join(this.directory, screenshot))
    await mkdir(join(this.directory, 'screens'), { recursive: true })
    const snapshot = await this.page.evaluate(() => {
      const intersectsViewport = el => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      }
      const exposedPoint = (rect, el) => {
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        return hit === el || (hit && el.contains(hit))
      }
      for (const element of document.querySelectorAll('[data-persona-ref]')) element.removeAttribute('data-persona-ref')
      const elements = []
      for (const el of document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="tab"],[aria-haspopup]')) {
        if (!intersectsViewport(el) || !exposedPoint(el.getBoundingClientRect(), el)) continue
        const ref = `e${elements.length + 1}`
        el.setAttribute('data-persona-ref', ref)
        const rect = el.getBoundingClientRect()
        const labels = el.labels ? [...el.labels].map(label => label.innerText).join(' ') : ''
        elements.push({ ref, tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || labels || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().slice(0, 180), href: el.href || null, type: el.type || null, x: Math.round(rect.x), y: Math.round(rect.y) })
      }
      const text = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement?.tagName) || !node.textContent.trim()) continue
        if (node.parentElement && intersectsViewport(node.parentElement)) {
          const range = document.createRange()
          const words = []
          for (const match of node.textContent.matchAll(/\S+/g)) {
            range.setStart(node, match.index)
            range.setEnd(node, match.index + match[0].length)
            if ([...range.getClientRects()].some(rect => exposedPoint(rect, node.parentElement))) words.push(match[0])
          }
          if (words.length) text.push(words.join(' '))
        }
      }
      return { url: location.href, title: document.title, text: text.join('\n').slice(0, 16000), elements, viewport: { width: innerWidth, height: innerHeight }, scrollY, scrollHeight: document.documentElement.scrollHeight }
    })
    await this.page.screenshot({ path: destination, fullPage: false })
    return { id: randomUUID(), observedAt: new Date().toISOString(), screenshot, ...snapshot }
  }

  async act(action) {
    this.run = await this.store.load(this.directory)
    assertBudget(this.run)
    const startedAt = new Date().toISOString()
    if (this.run.events.some(event => event.status === 'boundary')) throw new Error('Limite rencontrée : terminer cet essai')
    if (!ACTIONS.includes(action.type)) throw new Error('Type d’action inconnu')
    if (!action.reason?.trim() || !action.expectation?.trim()) throw new Error('Raison et attente requises avant l’action')
    if (action.observationId !== this.current.id) throw new Error('Observation périmée : utiliser le dernier observationId')
    const before = this.current
    let status = 'ok'
    let error
    try {
      if (this.page.url() !== before.url) throw new Error('La page a changé depuis la dernière observation')
      if (['click', 'hover', 'fill'].includes(action.type)) {
        const target = before.elements.find(element => element.ref === action.element)
        if (!target) throw new Error('Cible absente de l’écran observé')
        action = { ...action, label: target.label }
        const locator = this.page.locator(`[data-persona-ref="${target.ref}"]`)
        const rect = await locator.boundingBox()
        const viewport = this.page.viewportSize()
        if (!rect || rect.y >= viewport.height || rect.y + rect.height <= 0 || rect.x >= viewport.width || rect.x + rect.width <= 0) throw new Error('La cible est hors écran : observer à nouveau')
        if (action.type === 'click') {
          const liveTarget = await locator.evaluate(el => ({ label: (el.getAttribute('aria-label') || el.innerText || el.value || '').trim(), href: el.closest('a[href]')?.href, submit: !!el.form && ((el.tagName === 'BUTTON' && el.type === 'submit') || ['submit', 'image'].includes(el.type)) }))
          try { assertSafeClick(liveTarget, this.run.persona) } catch (caught) { status = 'boundary'; throw caught }
          await locator.click({ timeout: 6000 })
        } else if (action.type === 'hover') await locator.hover({ timeout: 6000 })
        else {
          if (!this.run.persona.scenario.allowFormInput) { status = 'boundary'; throw new Error('Saisie non autorisée pour cet essai') }
          if (target.type === 'password') { status = 'boundary'; throw new Error('Ne pas saisir de mot de passe dans une simulation') }
          if (typeof action.value !== 'string') throw new Error('value requis pour fill')
          await locator.fill(action.value, { timeout: 6000 })
        }
      } else if (action.type === 'scroll') {
        if (!['up', 'down'].includes(action.direction)) throw new Error('direction : up ou down')
        const amount = Math.min(Math.max(Number(action.amount) || 650, 100), this.page.viewportSize().height)
        await this.page.mouse.move(this.page.viewportSize().width / 2, this.page.viewportSize().height / 2)
        await this.page.mouse.wheel(0, action.direction === 'up' ? -amount : amount)
      } else if (action.type === 'back') await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 })
      else if (action.type === 'press') {
        if (!['Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(action.key)) { status = 'boundary'; throw new Error('Touche non autorisée ; les touches de soumission sont exclues') }
        await this.page.keyboard.press(action.key)
      }
      await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
      await this.page.waitForTimeout(400) // Stabilisation du rendu, pas un temps de lecture simulé.
      if (!inScope(this.page.url(), this.run.persona)) status = 'boundary'
    } catch (caught) { error = caught.message; if (status !== 'boundary') status = 'failed' }
    this.current = await this.observe()
    if (!inScope(this.current.url, this.run.persona)) status = 'boundary'
    const event = await this.store.record(this.directory, { startedAt, action, before, after: this.current, status, ...(error ? { error } : {}) })
    return { sequence: event.sequence, status, ...(error ? { error } : {}), observation: this.current }
  }

  async close() { if (this.session) await this.session.close() }
}
