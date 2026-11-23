# Navigateur local piloté par l’agent

Prérequis : ceux du dépôt (`npm install`, Google Chrome ou `CHROME_BIN`). Aucun modèle
n’est exécuté par le CLI. L’agent de la conversation lit le brief et choisit les actions.

`start` imprime le dossier d’essai. Lire son `BRIEF.md`, puis lancer :

```bash
npm run persona -- browser <dossier-essai> --headless
```

Omettre `--headless` pour une fenêtre visible. Garder stdin ouvert (terminal interactif
ou PTY) : le programme lit une action JSON par ligne. La première réponse contient
`observation.id`, l’URL, le texte dans le viewport, les éléments visibles avec leurs
références `e1`, `e2`, etc., et une capture relative au dossier d’essai. Examiner cette
capture lorsqu’elle aide à interpréter l’écran.

Exemple de forme d’action, à remplir à partir de l’observation courante :

```json
{"type":"click","element":"e7","observationId":"id-de-la-derniere-observation","reason":"La rubrique correspond au besoin du persona","expectation":"Voir les offres adaptées à son objectif"}
```

Les références sont invalidées après chaque observation. Ne jamais réutiliser un ancien
`observationId` ou inventer une référence. Une action produit une observation avant/après
et s’enregistre automatiquement. Actions disponibles :

- `click`, `hover` : `element` d’un écran observé ;
- `scroll` : `direction: "down"` ou `"up"`, `amount` facultatif, au plus un viewport ;
- `back` : historique du navigateur ;
- `press` : `key` parmi Escape, Tab et les quatre flèches ;
- `fill` : `element`, `value`, si le scénario autorise la saisie ;
- `observe` : observer de nouveau, compte dans le budget ;
- `close` : ferme le navigateur, sans déclarer l’objectif atteint.

Le garde-fou local refuse les soumissions HTML, les libellés de validation détectés et
les liens hors périmètre. Ce filtre réduit les erreurs ; il ne prouve pas l’absence
d’effet de bord d’un bouton JavaScript mal étiqueté. L’agent doit choisir seulement des
actions de navigation ou de consultation. Les blocages restent dans le journal.

Après `close`, préparer un bilan JSON dans le dossier privé :

```json
{
  "outcome": "partial",
  "summary": "Décrire ce qui a été atteint et ce qui manque, avec des faits observés.",
  "criteria": [
    {"id": "identifiant-du-critere", "met": false, "evidence": "Constat à l’écran", "eventSequences": [1]}
  ]
}
```

Puis :

```bash
npm run persona -- finish <dossier-essai> --result=<bilan.json>
npm run persona -- compare <dossier-essai-1> <dossier-essai-2>
```

Chaque essai a un `run.json`, un brief figé, les captures et une galerie `index.html`.
La comparaison crée une page locale qui pointe vers les galeries. Les budgets incluent
le temps de réflexion de l’agent. Le profil Chrome est neuf pour chaque essai. La reprise
d’un navigateur interrompu exige un nouvel essai ; aucune action n’est rejouée en secret.
Ne pas lancer plusieurs écrivains ou navigateurs sur le même dossier d’essai.
