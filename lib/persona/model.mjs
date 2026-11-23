export const PROVIDERS = ['playwright', 'claude-in-chrome', 'aside', 'browser-use', 'codex']
export const OUTCOMES = ['success', 'partial', 'blocked', 'abandoned']
export const ACTIONS = ['click', 'hover', 'scroll', 'back', 'press', 'fill', 'observe']

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const strings = (value) => Array.isArray(value) && value.every(nonempty)

export function webUrl(raw) {
  const url = new URL(raw)
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'URL HTTP(S) sans identifiants requise')
  return url
}

export function validatePersona(persona) {
  requireValue(persona?.schemaVersion === 1, 'schemaVersion doit être 1')
  requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(persona.id || ''), 'id : lettres minuscules, chiffres et tirets')
  for (const field of ['name', 'context', 'goal']) requireValue(nonempty(persona[field]), `${field} requis`)
  for (const field of ['digitalExperience', 'priorKnowledge']) requireValue(nonempty(persona.profile?.[field]), `profile.${field} requis`)
  for (const field of ['reading', 'navigation', 'recovery']) requireValue(nonempty(persona.behavior?.[field]), `behavior.${field} requis`)
  requireValue(strings(persona.behavior?.decisionCriteria) && persona.behavior.decisionCriteria.length > 0, 'Au moins un critère de décision requis')
  requireValue(strings(persona.behavior?.avoidances), 'behavior.avoidances doit être une liste de textes')
  requireValue(strings(persona.assumptions), 'assumptions doit être une liste de textes')
  const scenario = persona.scenario
  const start = webUrl(scenario?.startUrl)
  requireValue(['desktop', 'mobile'].includes(scenario.device), 'device : desktop ou mobile')
  requireValue(strings(scenario.allowedOrigins) && scenario.allowedOrigins.length > 0, 'allowedOrigins requis')
  for (const origin of scenario.allowedOrigins) requireValue(webUrl(origin).origin === origin, 'allowedOrigins contient seulement des origines, sans chemin ni slash final')
  requireValue(scenario.allowedOrigins.includes(start.origin), 'L’origine de départ doit être autorisée')
  for (const [key, max] of [['maxActions', 100], ['maxMinutes', 120], ['maxConsecutiveFailures', 10]]) {
    requireValue(Number.isInteger(scenario[key]) && scenario[key] > 0 && scenario[key] <= max, `${key} : entier entre 1 et ${max}`)
  }
  requireValue(typeof scenario.allowFormInput === 'boolean', 'allowFormInput doit être un booléen')
  requireValue(Array.isArray(scenario.successCriteria) && scenario.successCriteria.length > 0, 'successCriteria requis')
  const ids = new Set()
  for (const criterion of scenario.successCriteria) {
    requireValue(nonempty(criterion.id) && nonempty(criterion.label) && !ids.has(criterion.id), 'Critères : id unique et label requis')
    ids.add(criterion.id)
  }
  return persona
}

export function inScope(url, persona) {
  try { return persona.scenario.allowedOrigins.includes(webUrl(url).origin) } catch { return false }
}

export function assertBudget(run, at = Date.now()) {
  requireValue(run.status === 'running', 'Cet essai est terminé')
  requireValue(run.events.length < run.persona.scenario.maxActions, 'Budget d’actions atteint : terminer l’essai')
  requireValue(at - Date.parse(run.startedAt) < run.persona.scenario.maxMinutes * 60000, 'Budget de temps atteint : terminer l’essai')
  let failures = 0
  for (const event of [...run.events].reverse()) {
    if (event.status !== 'failed') break
    failures++
  }
  requireValue(failures < run.persona.scenario.maxConsecutiveFailures, 'Trop d’échecs consécutifs : terminer l’essai')
}

export function validateEvent(event, run) {
  const startedAt = event.startedAt ? Date.parse(event.startedAt) : Date.now()
  requireValue(Number.isFinite(startedAt) && startedAt >= Date.parse(run.startedAt) && startedAt <= Date.now(), 'Horodatage d’action invalide')
  assertBudget(run, startedAt)
  requireValue(ACTIONS.includes(event.action?.type), 'Type d’action inconnu')
  requireValue(nonempty(event.action?.reason) && nonempty(event.action?.expectation), 'Raison et attente de l’action requises')
  requireValue(['ok', 'failed', 'boundary'].includes(event.status), 'status : ok, failed ou boundary')
  for (const side of ['before', 'after']) {
    requireValue(nonempty(event[side]?.url) && typeof event[side]?.text === 'string', `Observation ${side} requise`)
    webUrl(event[side].url)
    requireValue(nonempty(event[side].screenshot) || nonempty(event[side].captureRef), `Capture ou référence d’outil ${side} requise`)
  }
  const initialRedirect = run.events.length === 0 && event.action.type === 'observe' && event.status === 'boundary' && event.before.url === event.after.url
  requireValue(inScope(event.before.url, run.persona) || initialRedirect, 'Départ de l’action hors périmètre')
  requireValue(inScope(event.after.url, run.persona) || event.status === 'boundary', 'Une sortie de périmètre doit être déclarée boundary')
  requireValue(!(event.action.type === 'fill' && !run.persona.scenario.allowFormInput), 'Saisie de formulaire non autorisée')
  requireValue(!run.events.some(item => item.status === 'boundary'), 'Limite rencontrée : terminer l’essai avant de poursuivre')
  return event
}

export function validateResult(result, run) {
  requireValue(run.status === 'running', 'Cet essai est déjà terminé')
  requireValue(OUTCOMES.includes(result?.outcome) && nonempty(result.summary), 'outcome et summary requis')
  requireValue(Array.isArray(result.criteria), 'criteria requis')
  requireValue(result.limitations === undefined || strings(result.limitations), 'limitations doit être une liste de textes')
  const seen = new Set()
  for (const criterion of run.persona.scenario.successCriteria) {
    const entries = result.criteria.filter(item => item.id === criterion.id)
    requireValue(entries.length === 1, `Bilan requis pour le critère ${criterion.id}`)
    const entry = entries[0]
    requireValue(typeof entry.met === 'boolean' && nonempty(entry.evidence), `Preuve et met requis pour ${criterion.id}`)
    requireValue(Array.isArray(entry.eventSequences), `eventSequences requis pour ${criterion.id}`)
    requireValue(entry.eventSequences.every(sequence => run.events.some(event => event.sequence === sequence)), 'Événement de preuve inexistant')
    requireValue(!entry.met || entry.eventSequences.length > 0, 'Un critère rempli exige un événement de preuve')
    seen.add(entry.id)
  }
  requireValue(result.criteria.length === seen.size, 'Critère inconnu ou dupliqué')
  requireValue(result.outcome !== 'success' || result.criteria.every(entry => entry.met), 'Succès impossible : critères incomplets')
  requireValue(result.outcome !== 'success' || !run.events.some(event => event.status === 'boundary'), 'Une limite de périmètre ne peut pas être un succès')
  return result
}

export function assertSafeClick(target, persona) {
  if (target.submit) throw new Error('Soumission de formulaire interdite')
  if (/\b(delete|remove|purchase|checkout|pay|submit|send|supprimer|effacer|acheter|commander|payer|envoyer|soumettre|publier|valider|confirmer)\b|s.inscrire|sign.?up|créer un compte/i.test(target.label || '')) {
    throw new Error('Action à effet de bord possible : arrêt avant validation')
  }
  if (target.href && !inScope(target.href, persona)) throw new Error('Lien hors des origines autorisées')
}
