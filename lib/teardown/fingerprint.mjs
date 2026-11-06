// Extrait le "comment c'est fait": stack technique et design tokens réellement
// appliqués. Pas ce que le site déclare dans sa doc — ce que le navigateur calcule.

const THIRD_PARTIES = [
  [/googletagmanager\.com/, 'Google Tag Manager', 'analytics'],
  [/google-analytics\.com|\/gtag\/js/, 'Google Analytics', 'analytics'],
  [/cdn\.segment\.(com|io)/, 'Segment', 'analytics'],
  [/posthog\.com|posthog\.io/, 'PostHog', 'analytics'],
  [/amplitude\.com/, 'Amplitude', 'analytics'],
  [/mixpanel\.com/, 'Mixpanel', 'analytics'],
  [/plausible\.io/, 'Plausible', 'analytics'],
  [/usefathom\.com/, 'Fathom', 'analytics'],
  [/clarity\.ms/, 'Microsoft Clarity', 'analytics'],
  [/hotjar\.(com|io)/, 'Hotjar', 'analytics'],
  [/fullstory\.com/, 'FullStory', 'analytics'],
  [/logrocket\.(com|io)/, 'LogRocket', 'analytics'],
  [/vercel\.(app|com)\/(_vercel\/)?insights|\/_vercel\/insights/, 'Vercel Analytics', 'analytics'],
  [/js\.stripe\.com|stripe\.network/, 'Stripe', 'paiement'],
  [/paddle\.com/, 'Paddle', 'paiement'],
  [/lemonsqueezy\.com/, 'Lemon Squeezy', 'paiement'],
  [/chargebee\.com/, 'Chargebee', 'paiement'],
  [/clerk\.(com|dev|accounts)/, 'Clerk', 'auth'],
  [/auth0\.com/, 'Auth0', 'auth'],
  [/supabase\.(co|com|in)/, 'Supabase', 'backend'],
  [/firebaseio\.com|firebaseapp\.com|googleapis\.com\/identitytoolkit/, 'Firebase', 'backend'],
  [/workos\.com/, 'WorkOS', 'auth'],
  [/intercom\.(io|com)/, 'Intercom', 'support'],
  [/crisp\.chat/, 'Crisp', 'support'],
  [/hs-scripts\.com|hsforms\.(net|com)|hubspot\.com/, 'HubSpot', 'crm'],
  [/drift\.com/, 'Drift', 'support'],
  [/zendesk\.com|zdassets\.com/, 'Zendesk', 'support'],
  [/front\.com|frontapp\.com/, 'Front', 'support'],
  [/sentry\.(io|com)|browser\.sentry-cdn/, 'Sentry', 'monitoring'],
  [/datadoghq\.com|datadog-browser/, 'Datadog', 'monitoring'],
  [/algolia(net)?\.(com|net)/, 'Algolia', 'recherche'],
  [/typesense\./, 'Typesense', 'recherche'],
  [/contentful\.com/, 'Contentful', 'cms'],
  [/sanity\.io/, 'Sanity', 'cms'],
  [/prismic\.io/, 'Prismic', 'cms'],
  [/storyblok\.com/, 'Storyblok', 'cms'],
  [/cdn\.shopify\.com/, 'Shopify', 'plateforme'],
  [/webflow\.(com|io)/, 'Webflow', 'plateforme'],
  [/framerusercontent\.com|framer\.(com|app)/, 'Framer', 'plateforme'],
  [/wixstatic\.com/, 'Wix', 'plateforme'],
  [/squarespace\.com/, 'Squarespace', 'plateforme'],
  [/calendly\.com/, 'Calendly', 'conversion'],
  [/typeform\.com/, 'Typeform', 'conversion'],
  [/cal\.com/, 'Cal.com', 'conversion'],
  [/loops\.so|customer\.io|klaviyo\.com|mailchimp\.com/, 'Email marketing', 'marketing'],
  [/mux\.com|vimeo\.com|wistia\.(com|net)|youtube\.com\/iframe/, 'Vidéo hébergée', 'media'],
]

function headerStack(headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  const found = []
  if (h['x-powered-by']) found.push(h['x-powered-by'])
  if (h['x-vercel-id'] || h['server'] === 'Vercel') found.push('Vercel')
  if (h['x-nf-request-id']) found.push('Netlify')
  if (h['cf-ray']) found.push('Cloudflare')
  if (h['x-amz-cf-id']) found.push('AWS CloudFront')
  if (h['x-served-by']?.includes('cache')) found.push('Fastly')
  if (h['x-shopify-stage']) found.push('Shopify')
  if (h['server'] && !/^(cloudflare|vercel)$/i.test(h['server'])) found.push(h['server'])
  return [...new Set(found)]
}

// Tout ce qui suit tourne DANS la page: c'est la seule façon d'obtenir les styles
// calculés (donc les tokens réellement appliqués, après cascade et media queries).
async function readPage(page) {
  return page.evaluate(() => {
    const top = (map, n) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([value, count]) => ({ value, count }))

    const bump = (map, key) => {
      if (!key) return
      map.set(key, (map.get(key) || 0) + 1)
    }

    const rgbToHex = (c) => {
      const m = String(c).match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      const [r, g, b] = parts
      const a = parts.length > 3 ? parts[3] : 1
      if (a === 0) return null
      if ([r, g, b].some((v) => Number.isNaN(v))) return null
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
      return a < 1 ? `${hex} (α${a})` : hex
    }

    // ── framework ──────────────────────────────────────────────────────────
    const framework = []
    if (window.__NEXT_DATA__ || document.querySelector('#__next, script#__NEXT_DATA__')) framework.push('Next.js')
    if (window.__NUXT__ || document.querySelector('#__nuxt')) framework.push('Nuxt')
    if (window.__remixContext) framework.push('Remix')
    if (document.querySelector('[data-sveltekit-preload-data], script[data-sveltekit]') || window.__sveltekit)
      framework.push('SvelteKit')
    if (window.Vue || document.querySelector('[data-v-app], #app[data-v-]')) framework.push('Vue')
    if (window.ng || document.querySelector('[ng-version]')) framework.push('Angular')
    if (window.Astro || document.querySelector('astro-island')) framework.push('Astro')
    if (window.Shopify) framework.push('Shopify')
    if (document.querySelector('link[href*="wp-content"], meta[name="generator"][content*="WordPress" i]'))
      framework.push('WordPress')
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot], #root'))
      framework.push('React')
    if (document.querySelector('[data-turbo], [data-controller]')) framework.push('Hotwire / Stimulus')

    const generator = document.querySelector('meta[name="generator"]')?.content || null

    // ── CSS: Tailwind laisse une signature très reconnaissable ────────────
    const classSample = [...document.querySelectorAll('[class]')]
      .slice(0, 1200)
      .map((el) => el.getAttribute('class'))
      .join(' ')
    const css = []
    if (/\b(flex|grid|hidden|block)\b/.test(classSample) && /\b(p|m|px|py|mt|mb|gap|text|bg)-\d/.test(classSample))
      css.push('Tailwind CSS')
    if (/\bcss-[a-z0-9]{6,}\b/.test(classSample)) css.push('CSS-in-JS (emotion / styled-components)')
    if (/\b[\w-]+__[\w-]+(--[\w-]+)?\b/.test(classSample)) css.push('BEM')
    if (/\b[\w-]+_[\w-]+__[a-zA-Z0-9]{5,}\b/.test(classSample)) css.push('CSS Modules')
    if (/\bchakra-|\bMui[A-Z]|\bant-|\bmantine-/.test(classSample)) css.push('Librairie de composants (Chakra / MUI / AntD / Mantine)')

    // ── scripts tiers ──────────────────────────────────────────────────────
    const scriptSrc = [...document.querySelectorAll('script[src]')].map((s) => s.src)
    const linkHref = [...document.querySelectorAll('link[href]')].map((l) => l.href)

    // ── tokens: variables CSS ─────────────────────────────────────────────
    const vars = {}
    const rootStyle = getComputedStyle(document.documentElement)
    for (let i = 0; i < rootStyle.length; i++) {
      const prop = rootStyle[i]
      if (prop.startsWith('--')) vars[prop] = rootStyle.getPropertyValue(prop).trim()
    }
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue // feuille cross-origin: illisible, c'est normal
      }
      for (const rule of rules || []) {
        if (!rule.style || !/^(:root|html|\[data-theme|\.dark|:host)/.test(rule.selectorText || '')) continue
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i]
          if (prop.startsWith('--') && !vars[prop]) vars[prop] = rule.style.getPropertyValue(prop).trim()
        }
      }
    }

    // ── tokens: styles calculés sur un échantillon large ──────────────────
    const fonts = new Map()
    const sizes = new Map()
    const weights = new Map()
    const colors = new Map()
    const backgrounds = new Map()
    const radii = new Map()
    const shadows = new Map()
    const spacing = new Map()

    const nodes = [...document.querySelectorAll('body *')].slice(0, 2500)
    for (const el of nodes) {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue

      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (hasText) {
        bump(fonts, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim())
        bump(sizes, cs.fontSize)
        bump(weights, cs.fontWeight)
        bump(colors, rgbToHex(cs.color))
      }
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bump(backgrounds, rgbToHex(cs.backgroundColor))
      if (cs.borderRadius && cs.borderRadius !== '0px') bump(radii, cs.borderRadius)
      if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadows, cs.boxShadow.slice(0, 80))
      for (const p of [cs.paddingTop, cs.paddingLeft, cs.marginBottom, cs.gap]) {
        if (p && p !== '0px' && p !== 'normal' && /^\d+(\.\d+)?px$/.test(p)) bump(spacing, p)
      }
    }

    const themeColor = document.querySelector('meta[name="theme-color"]')?.content || null
    const supportsDark =
      !!document.querySelector('[data-theme], .dark, [class*="dark:"]') ||
      /prefers-color-scheme:\s*dark/.test(
        [...document.styleSheets]
          .map((s) => {
            try {
              return [...(s.cssRules || [])].map((r) => r.conditionText || '').join(' ')
            } catch {
              return ''
            }
          })
          .join(' ')
      )

    return {
      framework: [...new Set(framework)],
      generator,
      css: [...new Set(css)],
      scriptSrc,
      linkHref,
      lang: document.documentElement.lang || null,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || null,
      tokens: {
        cssVariables: vars,
        fonts: top(fonts, 6),
        fontSizes: top(sizes, 12),
        fontWeights: top(weights, 6),
        textColors: top(colors, 10),
        backgrounds: top(backgrounds, 10),
        radii: top(radii, 8),
        shadows: top(shadows, 5),
        spacing: top(spacing, 12),
        themeColor,
        supportsDark,
      },
    }
  })
}

function detectThirdParties(urls) {
  const found = new Map()
  for (const url of urls) {
    for (const [re, name, category] of THIRD_PARTIES) {
      if (re.test(url)) found.set(name, category)
    }
  }
  return [...found.entries()].map(([name, category]) => ({ name, category }))
}

export async function fingerprintPage(page, { headers = {} } = {}) {
  const data = await readPage(page).catch(() => null)
  if (!data) return null

  const thirdParties = detectThirdParties([...data.scriptSrc, ...data.linkHref])
  const hosting = headerStack(headers)

  delete data.scriptSrc
  delete data.linkHref

  return { ...data, thirdParties, hosting }
}

// Fusionne les relevés de plusieurs pages: la home révèle le marketing, l'app
// révèle l'outillage produit. Aucune des deux ne suffit seule.
export function mergeFingerprints(list) {
  const kept = list.filter(Boolean)
  if (!kept.length) return null

  const uniq = (arr) => [...new Set(arr.filter(Boolean))]
  const mergeCounts = (key) => {
    const map = new Map()
    for (const f of kept) {
      for (const { value, count } of f.tokens?.[key] || []) map.set(value, (map.get(value) || 0) + count)
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([value, count]) => ({ value, count }))
  }

  const thirdParties = new Map()
  for (const f of kept) for (const tp of f.thirdParties || []) thirdParties.set(tp.name, tp.category)

  const cssVariables = {}
  for (const f of kept) Object.assign(cssVariables, f.tokens?.cssVariables || {})

  return {
    framework: uniq(kept.flatMap((f) => f.framework)),
    generator: kept.find((f) => f.generator)?.generator || null,
    css: uniq(kept.flatMap((f) => f.css)),
    hosting: uniq(kept.flatMap((f) => f.hosting)),
    lang: kept.find((f) => f.lang)?.lang || null,
    thirdParties: [...thirdParties.entries()].map(([name, category]) => ({ name, category })),
    tokens: {
      cssVariables,
      fonts: mergeCounts('fonts'),
      fontSizes: mergeCounts('fontSizes'),
      fontWeights: mergeCounts('fontWeights'),
      textColors: mergeCounts('textColors'),
      backgrounds: mergeCounts('backgrounds'),
      radii: mergeCounts('radii'),
      shadows: mergeCounts('shadows'),
      spacing: mergeCounts('spacing'),
      themeColor: kept.find((f) => f.tokens?.themeColor)?.tokens.themeColor || null,
      supportsDark: kept.some((f) => f.tokens?.supportsDark),
    },
  }
}
