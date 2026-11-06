// Galerie HTML autonome: un seul fichier, aucune dépendance, ouvrable au double-clic
// des mois plus tard. C'est ce qu'on ouvre quand on cherche "comment ils ont fait
// leur onboarding, déjà ?".

import { writeFile } from 'fs/promises'
import { join } from 'path'

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const TYPE_LABELS = {
  home: 'Accueil',
  product: 'Produit',
  pricing: 'Tarifs',
  auth: 'Connexion / inscription',
  app: 'Application',
  settings: 'Réglages',
  profile: 'Profil',
  billing: 'Facturation',
  team: 'Équipe',
  company: 'Entreprise',
  listing: 'Listings',
  'listing-item': 'Listings',
  'content-index': 'Contenu',
  other: 'Autres',
}

function card(shot) {
  const desktop = shot.shots?.desktop
  const mobile = shot.shots?.mobile
  if (!desktop && !mobile) return ''
  return `
    <figure class="card">
      <div class="frame">
        ${desktop ? `<a href="${esc(desktop)}" target="_blank"><img class="vp-desktop" loading="lazy" src="${esc(desktop)}" alt="${esc(shot.title || shot.url)}"></a>` : ''}
        ${mobile ? `<a href="${esc(mobile)}" target="_blank"><img class="vp-mobile" loading="lazy" src="${esc(mobile)}" alt="${esc(shot.title || shot.url)}"></a>` : ''}
      </div>
      <figcaption>
        ${shot.role ? `<span class="role">${esc(shot.role)}</span>` : ''}
        <strong>${esc(shot.title || shot.url)}</strong>
        ${shot.note ? `<em class="note">${esc(shot.note)}</em>` : ''}
        <a class="url" href="${esc(shot.url)}" target="_blank" rel="noreferrer">${esc(shot.url)}</a>
      </figcaption>
    </figure>`
}

export async function writeGallery(outDir, data) {
  const { host, date, pages, journeys, fingerprint, stats } = data

  const byType = new Map()
  for (const p of pages) {
    if (!p.shots?.desktop && !p.shots?.mobile) continue
    const key = TYPE_LABELS[p.type] || 'Autres'
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key).push(p)
  }

  const stackBits = [
    ...(fingerprint?.framework || []),
    ...(fingerprint?.css || []),
    ...(fingerprint?.hosting || []).slice(0, 2),
  ].slice(0, 6)

  const palette = (fingerprint?.tokens?.backgrounds || [])
    .concat(fingerprint?.tokens?.textColors || [])
    .filter((c) => /^#[0-9a-f]{6}$/i.test(c.value))
    .slice(0, 12)

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teardown ${esc(host)} — ${esc(date)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #16161a; --muted: #6b6b76; --line: #e6e6ea; --card: #fafafb; --accent: #3b5bdb;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #131316; --fg: #ececf0; --muted: #9a9aa6; --line: #2a2a31; --card: #1b1b20; --accent: #8da2fb; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 32px 24px 96px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 24px; margin-bottom: 32px; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.02em; }
  h1 a { color: inherit; text-decoration: none; }
  h1 a:hover { color: var(--accent); }
  .meta { color: var(--muted); font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  .chip { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; color: var(--muted); }
  .swatches { display: flex; gap: 4px; margin-top: 12px; flex-wrap: wrap; }
  .sw { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--line); }
  .controls { position: sticky; top: 0; z-index: 10; background: var(--bg);
    padding: 12px 0; border-bottom: 1px solid var(--line); margin-bottom: 24px;
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
  button[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  h2 { font-size: 19px; margin: 40px 0 4px; letter-spacing: -0.01em; }
  h2 .count { color: var(--muted); font-weight: 400; font-size: 14px; }
  .grid { display: grid; gap: 20px; margin-top: 18px;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  body[data-vp="mobile"] .grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
  .card { margin: 0; background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .frame { background: var(--bg); border-bottom: 1px solid var(--line); overflow: hidden;
    max-height: 380px; display: flex; justify-content: center; }
  .frame img { width: 100%; height: auto; display: block; object-fit: cover; object-position: top; }
  body[data-vp="desktop"] .vp-mobile, body[data-vp="mobile"] .vp-desktop { display: none; }
  figcaption { padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  figcaption strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); font-weight: 600; }
  .note { color: var(--muted); font-style: normal; font-size: 12px; }
  .url { color: var(--muted); font-size: 11px; text-decoration: none;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .url:hover { color: var(--accent); }
  .journey .grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .lead { color: var(--muted); font-size: 14px; margin: 4px 0 0; }
</style>
</head>
<body data-vp="desktop">
<div class="wrap">
  <header>
    <h1><a href="https://${esc(host)}" target="_blank" rel="noreferrer">${esc(host)}</a></h1>
    <div class="meta">Teardown du ${esc(date)} · ${stats.captured} écrans capturés · ${stats.discovered} URLs connues · ${journeys.length} parcours</div>
    ${stackBits.length ? `<div class="chips">${stackBits.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
    ${palette.length ? `<div class="swatches">${palette.map((c) => `<span class="sw" style="background:${esc(c.value)}" title="${esc(c.value)}"></span>`).join('')}</div>` : ''}
  </header>

  <div class="controls">
    <button id="btn-desktop" aria-pressed="true">Desktop</button>
    <button id="btn-mobile" aria-pressed="false">Mobile</button>
  </div>

  ${journeys
    .map(
      (j) => `
  <section class="journey">
    <h2>${esc(j.label)} <span class="count">${j.steps.length} étapes</span></h2>
    <div class="grid">${j.steps.map((s) => card({ ...s, shots: s.shots })).join('')}</div>
  </section>`
    )
    .join('')}

  <section>
    <h2>Toutes les pages <span class="count">${stats.captured} écrans</span></h2>
    <p class="lead">Juridique, erreurs, articles de blog et pages de docs sont volontairement exclus.</p>
  </section>
  ${[...byType.entries()]
    .map(
      ([label, items]) => `
  <section>
    <h2>${esc(label)} <span class="count">${items.length}</span></h2>
    <div class="grid">${items.map(card).join('')}</div>
  </section>`
    )
    .join('')}
</div>
<script>
  const body = document.body
  const btnD = document.getElementById('btn-desktop')
  const btnM = document.getElementById('btn-mobile')
  function set(vp) {
    body.dataset.vp = vp
    btnD.setAttribute('aria-pressed', String(vp === 'desktop'))
    btnM.setAttribute('aria-pressed', String(vp === 'mobile'))
  }
  btnD.addEventListener('click', () => set('desktop'))
  btnM.addEventListener('click', () => set('mobile'))
</script>
</body>
</html>`

  await writeFile(join(outDir, 'index.html'), html, 'utf8')
}
