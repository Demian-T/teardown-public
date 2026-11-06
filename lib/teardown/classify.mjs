// Décide, pour chaque URL rencontrée, ce qu'on en fait.
//
// Trois verdicts:
//   capture     → on charge la page et on la screenshote
//   sample      → listing produit (intégrations, templates, clients): on capture
//                 l'index et deux exemplaires, pas les 300 items
//   index-only  → blog, docs, help, changelog: on capture la page d'index pour
//                 garder la trace, et on ne descend pas dedans
//   skip        → juridique, erreurs, flux, binaires: jamais capturé
//
// L'objectif est qu'un teardown de 60 pages contienne 60 pages DIFFÉRENTES, pas
// 50 variantes du même gabarit d'article.

const TRACKING_PARAMS =
  /^(utm_|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|ref|referrer|source|_hs|hsa_|igshid|si$)/i

// Juridique, erreurs, bruit. Jamais capturé.
const HARD_SKIP = [
  /\/(terms|tos|term-of-service|terms-of-use|terms-and-conditions)(\/|$)/i,
  /\/(cgv|cgu|conditions-generales|mentions-legales|mentions_legales)(\/|$)/i,
  /\/(privacy|privacy-policy|confidentialite|politique-de-confidentialite)(\/|$)/i,
  /\/(legal|imprint|impressum|eula|sla|dpa|gdpr|rgpd|sub-?processors)(\/|$)/i,
  /\/(cookie|cookies|cookie-policy|do-not-sell)(\/|$)/i,
  /\/(acceptable-use|abuse|disclaimer|refund|responsible-disclosure)(\/|$)/i,
  /\/(accessibility|accessibilite)(-statement)?(\/|$)/i,
  /\/(404|500|error|not-found|maintenance|offline)(\/|$)/i,
  /\/(logout|log-out|signout|sign-out|deconnexion|unsubscribe)(\/|$)/i,
  /\/(rss|feed|atom|sitemap)(\.xml|\.json)?(\/|$)/i,
  /\/(cdn-cgi|__|wp-admin|wp-json|xmlrpc)(\/|$)/i,
]

// Contenu éditorial: on garde l'index, on n'entre pas.
const INDEX_ONLY = [
  /\/(blog|news|press|newsroom|articles|posts|stories)(\/|$)/i,
  /\/(docs|doc|documentation|developers|developer|api-docs|api-reference|reference)(\/|$)/i,
  /\/(help|support|kb|knowledge-?base|academy|learn|tutorials|guides)(\/|$)/i,
  /\/(changelog|releases|release-notes|whats-new|updates|roadmap)(\/|$)/i,
  /\/(careers|jobs|hiring)(\/|$)/i,
  /\/(events|webinars|community|forum)(\/|$)/i,
]

// Vitrines produit à forte densité: index + deux exemplaires suffisent à voir le gabarit.
const SAMPLE_ONLY = [
  /\/(integrations|apps|marketplace|extensions|plugins|connectors)(\/|$)/i,
  /\/(templates|gallery|showcase|examples)(\/|$)/i,
  /\/(customers|case-stud(y|ies)|clients|testimonials)(\/|$)/i,
]

const ASSET_EXT =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|gz|tar|dmg|exe|mp4|mp3|wav|woff2?|ttf|css|js|map|txt|xml|json|csv)$/i

const TYPE_RULES = [
  ['pricing', /\/(pricing|plans|tarifs|prix|upgrade)(\/|$)/i],
  ['billing', /\/(billing|subscription|invoices?|payment|checkout)(\/|$)/i],
  ['auth', /\/(login|signin|sign-in|signup|sign-up|register|onboarding|welcome|get-started)(\/|$)/i],
  ['settings', /\/(settings|preferences|configuration|admin|manage)(\/|$)/i],
  ['profile', /\/(profile|profil|me|account|users?\/)(\/|$)/i],
  ['team', /\/(team|members|workspace|organization|org|people|seats)(\/|$)/i],
  ['app', /\/(app|dashboard|home|console|projects?|workspace|inbox|library)(\/|$)/i],
  ['product', /\/(product|features?|solutions?|platform|use-?cases?|why-|how-it-works|tour)(\/|$)/i],
  ['company', /\/(about|company|team|manifesto|story|contact|security|trust)(\/|$)/i],
]

export function isAsset(url) {
  try {
    return ASSET_EXT.test(new URL(url).pathname)
  } catch {
    return true
  }
}

// Ramène une URL à sa forme canonique: pas de fragment, pas de paramètres de
// tracking, pas de slash final. Deux URLs qui désignent la même page doivent
// produire exactement la même chaîne, sinon le crawl tourne en rond.
export function normalizeUrl(href, base) {
  let u
  try {
    u = new URL(href, base)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  u.hash = ''
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
  }
  u.searchParams.sort()
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
  // www.site.com et site.com sont le même site: on aligne sur la forme sans www.
  u.hostname = u.hostname.replace(/^www\./i, '')
  return u.toString()
}

function isDynamicSegment(seg) {
  if (/^\d+$/.test(seg)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return true // uuid
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true // hash
  if (seg.length >= 24) return true
  if (seg.length >= 12 && (seg.match(/-/g) || []).length >= 2) return true // slug d'article
  if (/\d{4,}/.test(seg)) return true
  return false
}

// Signature de gabarit: /blog/comment-faire-x et /blog/pourquoi-y partagent
// /blog/:slug, donc le même template, donc un seul screenshot.
export function urlPattern(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const segs = u.pathname.split('/').filter(Boolean)
  const shaped = segs.map((s, i) => (i > 0 && isDynamicSegment(s) ? ':seg' : s.toLowerCase()))
  const query = [...u.searchParams.keys()].sort().join(',')
  return '/' + shaped.join('/') + (query ? `?${query}` : '')
}

export function pageType(url) {
  let path
  try {
    path = new URL(url).pathname
  } catch {
    return 'other'
  }
  if (path === '/' || path === '') return 'home'
  for (const [type, re] of TYPE_RULES) if (re.test(path)) return type
  for (const re of INDEX_ONLY) if (re.test(path)) return 'content'
  return 'other'
}

// depth 0 = la home. `isRoot` distingue /blog (l'index, qu'on garde) de
// /blog/mon-article (qu'on jette).
// Ordre dans lequel on veut dépenser le budget de captures. Sert à la fois à trier
// les amorces et à ordonner le frontier: sans ça, les 900 URLs d'un sitemap
// passent toutes avant le lien "Se connecter" trouvé dans la nav, et on ne voit
// jamais l'intérieur du produit.
export const TYPE_PRIORITY = {
  home: 0,
  product: 1,
  pricing: 2,
  app: 3,
  auth: 4,
  settings: 5,
  profile: 5,
  billing: 5,
  team: 5,
  listing: 6,
  other: 7,
  company: 8,
  'content-index': 9,
  content: 9,
  'listing-item': 9,
}

export function priorityScore(url, depth = 0) {
  const type = pageType(url)
  let pathDepth = 0
  try {
    pathDepth = new URL(url).pathname.split('/').filter(Boolean).length
  } catch {
    pathDepth = 9
  }
  return (TYPE_PRIORITY[type] ?? 7) * 100 + depth * 10 + pathDepth
}

export function classify(url) {
  let path
  try {
    path = new URL(url).pathname
  } catch {
    return { action: 'skip', type: 'other', reason: 'url invalide' }
  }

  if (isAsset(url)) return { action: 'skip', type: 'asset', reason: 'fichier, pas une page' }

  for (const re of HARD_SKIP) {
    if (re.test(path)) return { action: 'skip', type: 'legal', reason: 'juridique / erreur / flux' }
  }

  const type = pageType(url)
  const segs = path.split('/').filter(Boolean)

  for (const re of INDEX_ONLY) {
    if (!re.test(path)) continue
    return segs.length <= 1
      ? { action: 'capture', type: 'content-index', reason: "index éditorial" }
      : { action: 'index-only', type: 'content', reason: 'contenu éditorial, exclu par défaut' }
  }

  for (const re of SAMPLE_ONLY) {
    if (!re.test(path)) continue
    return segs.length <= 1
      ? { action: 'capture', type: 'listing', reason: 'index de listing' }
      : { action: 'sample', type: 'listing-item', reason: 'item de listing, échantillonné' }
  }

  return { action: 'capture', type, reason: 'page produit' }
}
