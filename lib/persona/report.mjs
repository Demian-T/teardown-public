import { relative } from 'node:path'

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const esc = escapeHtml
const status = { success: 'Objectif atteint', partial: 'Objectif partiel', blocked: 'Parcours bloqué', abandoned: 'Abandon simulé', running: 'En cours' }
const css = `body{margin:0;background:#f7f7fb;color:#19192b;font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:36px 24px}h1,h2{line-height:1.2}a{color:#5038bd}header,article,.card{background:white;border:1px solid #dddde8;border-radius:14px;padding:22px;margin:18px 0}.meta{color:#626276}img{display:block;max-width:100%;max-height:650px;object-fit:contain;object-position:top left;border:1px solid #dddde8}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #dddde8}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 system-ui} .tag{display:inline-block;background:#eee9ff;color:#432a94;border-radius:99px;padding:3px 10px} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}`
const document = (title, content) => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style><main>${content}</main></html>`
const videoScript = `<script>
  for (const button of document.querySelectorAll('[data-video-time]')) button.addEventListener('click', () => {
    const video = document.getElementById('journey-video')
    const seek = () => {
      const time = Number(button.dataset.videoTime)
      video.currentTime = Number.isFinite(video.duration) ? Math.min(time, video.duration) : time
      video.scrollIntoView({ behavior: 'smooth', block: 'center' })
      video.play().catch(() => {})
    }
    if (video.readyState >= 1) seek()
    else { video.addEventListener('loadedmetadata', seek, { once: true }); video.load() }
  })
</script>`

function recordingSection(recording) {
  if (!recording) return ''
  if (recording.status === 'recording') return '<section class="card" id="enregistrement"><h2>Vidéo du parcours</h2><p>Enregistrement en cours. Fermer le navigateur pour finaliser la vidéo.</p></section>'
  if (recording.status === 'failed') return `<section class="card" id="enregistrement"><h2>Vidéo du parcours</h2><p>Enregistrement indisponible : ${esc(recording.error || 'échec de la capture')}</p></section>`
  if (recording.status !== 'ready') return ''
  return `<section class="card" id="enregistrement"><h2>Vidéo du parcours</h2><video id="journey-video" controls playsinline preload="metadata" style="width:100%;max-height:650px;background:#101020"><source src="${esc(recording.path)}" type="${esc(recording.mimeType)}"></video><p>${recording.method === 'chrome-screencast' ? 'Capture continue du viewport actif du navigateur, sans audio.' : 'Vidéo jointe depuis un outil externe.'} <a href="${esc(recording.path)}" download>Télécharger la vidéo</a></p></section>`
}

function videoLink(run, event) {
  if (run.recording?.status !== 'ready' || !Number.isFinite(event.videoTimeSeconds)) return ''
  const seconds = Math.floor(event.videoTimeSeconds)
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return `<p><button type="button" data-video-time="${event.videoTimeSeconds}">Revoir l’action (${label})</button></p>`
}

export function renderRun(run) {
  const result = run.result
  const criteria = run.persona.scenario.successCriteria.map(criterion => {
    const entry = result?.criteria.find(item => item.id === criterion.id)
    return `<tr><td>${esc(criterion.label)}</td><td>${entry ? entry.met ? 'Oui' : 'Non' : 'À vérifier'}</td><td>${esc(entry?.evidence || '')}${entry?.eventSequences.length ? ` (étapes ${entry.eventSequences.join(', ')})` : ''}</td></tr>`
  }).join('')
  return document(`Parcours — ${run.persona.name}`, `<header><span class="tag">${esc(status[result?.outcome || run.status])}</span><h1>${esc(run.persona.name)}</h1><p>${esc(run.persona.goal)}</p><p class="meta">${esc(run.provider)} · ${esc(run.persona.scenario.device)} · ${run.events.length} actions observées</p><p>Simulation par agent IA. Les comportements sont des hypothèses de scénario, pas une étude menée avec des utilisateurs réels. La durée mesurée est celle de l’automatisation.</p><p>${esc(result?.summary || 'Essai non terminé.')}</p><a href="BRIEF.md">Brief du persona</a> · <a href="run.json">Journal complet</a></header>
  ${result?.limitations?.length ? `<div class="card"><h2>Limites de cet essai</h2><ul>${result.limitations.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
  ${run.pendingAction ? '<div class="card"><h2>Journal incomplet</h2><p>Une action a été préparée mais son résultat n’a pas pu être confirmé dans le journal. Consulter pendingAction dans run.json ; ne pas la rejouer automatiquement.</p></div>' : ''}
  ${recordingSection(run.recording)}
  <h2>Critères de réussite</h2><div class="card"><table><thead><tr><th>Critère</th><th>Observé</th><th>Preuve</th></tr></thead><tbody>${criteria}</tbody></table></div>
  <h2>Parcours observé</h2>${run.events.map(event => `<article><h3>${event.sequence}. ${esc(event.action.type)} — ${esc(event.action.label || event.action.element || '')}</h3><p><strong>Pourquoi :</strong> ${esc(event.action.reason)}</p><p><strong>Attente :</strong> ${esc(event.action.expectation)}</p><p><strong>Résultat :</strong> ${esc(event.status)}${event.error ? ` — ${esc(event.error)}` : ''}</p><p class="meta">${esc(event.after.url)}${event.after.unavailable ? ' (dernière adresse connue)' : ''}</p>${videoLink(run, event)}${event.after.unavailable ? `<p>Observation indisponible : ${esc(event.after.error)}</p>` : event.after.screenshot ? `<a href="${esc(event.after.screenshot)}"><img loading="lazy" src="${esc(event.after.screenshot)}" alt="Écran après l’étape ${event.sequence}"></a>` : `<p>Capture externe : ${esc(event.after.captureRef)}</p>`}<details><summary>Texte observé à l’écran</summary><pre>${esc(event.after.text)}</pre></details></article>`).join('')}${run.recording?.status === 'ready' ? videoScript : ''}`)
}

export function renderComparison(runs, outputDirectory) {
  const cards = runs.map(({ run, directory }) => {
    const path = relative(outputDirectory, directory).split('\\').join('/')
    const lastShot = run.events.at(-1)?.after.screenshot
    return `<article><span class="tag">${esc(status[run.result?.outcome || run.status])}</span><h2>${esc(run.persona.name)}</h2><p>${esc(run.persona.goal)}</p><p>${esc(run.result?.summary || 'En cours')}</p><p class="meta">${esc(run.provider)} · ${esc(run.persona.scenario.device)} · ${run.events.length} actions</p>${lastShot ? `<a href="${esc(path)}/index.html"><img loading="lazy" src="${esc(path)}/${esc(lastShot)}" alt="Dernier écran du parcours de ${esc(run.persona.name)}"></a>` : ''}<p><a href="${esc(path)}/index.html">Voir les écrans et le parcours</a>${run.recording?.status === 'ready' ? ` · <a href="${esc(path)}/index.html#enregistrement">Voir la vidéo</a>` : ''}</p></article>`
  }).join('')
  return document('Comparaison des parcours persona', `<header><h1>Parcours persona</h1><p>Essais synthétiques sur navigateur réel. Les résultats décrivent ces scénarios ; ils ne prédisent pas le comportement d’une population et ne constituent pas des taux de conversion.</p></header><div class="grid">${cards}</div>`)
}
