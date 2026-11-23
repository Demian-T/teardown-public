# Claude in Chrome et autres agents navigateur

Ce mode est un transfert de brief et une importation de preuves. Le CLI ne fournit pas
les outils de Claude in Chrome, d’Aside, de Codex ou du projet browser-use ; ces outils
doivent être disponibles dans l’environnement qui effectue la navigation. Le provider
sert à identifier le moteur réellement utilisé dans le rapport.

```bash
npm run persona -- start <persona.json> --provider=claude-in-chrome
npm run persona -- brief <dossier-essai>
```

Providers externes : `claude-in-chrome`, `aside`, `browser-use`, `codex`. Copier le brief
dans l’agent choisi, ou lui donner son chemin s’il accède aux fichiers. Le brief contient
le persona, les critères, les budgets et le contrat de navigation ; il n’expose aucun
résultat du crawler.

## Correspondance des capacités

| Besoin | Claude in Chrome / navigateur Codex | Aside | Agent browser-use |
|---|---|---|---|
| Session | Créer un onglet ou groupe dédié avec les outils exposés | Ouvrir un onglet dédié selon son guide | Créer un contexte neuf si disponible |
| Observation | Capture et lecture de la page avec les outils fournis | Snapshot et capture selon son guide | Capture et état du navigateur |
| Action | Cliquer, défiler, revenir, ouvrir un menu | Actions sur les références observées | Action choisie par l’agent |
| Preuve | Fichier ou référence de capture de l’outil | Fichier ou référence de capture de l’outil | Capture et sortie structurée |

Ne pas supposer le nom ou la signature d’un outil : consulter ceux que l’environnement
expose. Un snapshot peut inclure des éléments hors écran ; le persona doit d’abord les
découvrir en défilant. Les règles de l’outil restent applicables.

## Importer ce qui a réellement été fait

Enregistrer chaque action, dans l’ordre, dans un fichier JSON privé, puis :

```bash
npm run persona -- record <dossier-essai> --event=<etape.json>
```

Format d’une étape :

```json
{
  "action": {
    "type": "scroll",
    "reason": "Le persona cherche encore une information annoncée plus bas",
    "expectation": "Voir la suite des offres"
  },
  "before": {"url": "https://example.com/", "text": "Texte réellement observé", "captureRef": "référence réelle de capture avant"},
  "after": {"url": "https://example.com/", "text": "Nouveau texte réellement observé", "captureRef": "référence réelle de capture après"},
  "status": "ok"
}
```

Utiliser `screenshot: "screens/nom.png"` si le fichier a été copié dans le dossier de
l’essai. Sinon conserver `captureRef` sans inventer de chemin : la galerie affiche la
référence, mais ne peut pas intégrer une image inaccessible localement. `failed` décrit
un échec d’outil ; `boundary` indique une limite de périmètre ou de validation et met fin
aux actions de l’essai. Les gardes du navigateur local ne peuvent pas intercepter les
actions exécutées par un autre outil : l’agent externe doit appliquer le même contrat.

L’import est une attestation de l’agent externe, pas une vérification automatique de son
activité. Garder la référence à sa session dans le bilan si disponible. Importer au fil
de l’eau pour que les budgets restent utiles. Ne pas relancer une action seulement pour
remplir le journal, notamment à proximité d’une validation.

Terminer avec `finish` et le bilan décrit dans [local-browser.md](local-browser.md).

## Joindre la vidéo d’un outil externe

Si l’agent navigateur ou son environnement permet un véritable enregistrement, le
démarrer avant le parcours et l’arrêter à la fin. Le dépôt ne peut pas activer à distance
un enregistreur absent de cet outil. Signaler l’absence de cette capacité lorsqu’elle
empêche de fournir la vidéo demandée ; conserver les captures existantes comme telles.

Copier le résultat MP4 ou WebM avec :

```bash
npm run persona -- attach-video <dossier-essai> --file=<enregistrement.mp4>
```

L’import fonctionne aussi après le bilan. Il ajoute un lecteur au rapport sans modifier
les actions ni les critères. La copie reste privée. Pour des liens de lecture par étape,
fournir `videoTimeSeconds` dans chaque événement avec son véritable décalage en secondes
depuis le début de ce même enregistrement. Ne pas calculer ces décalages depuis une
autre horloge, une vidéo recoupée ou les captures seules.

Les fichiers importés, briefs remplis, captures et vidéos restent dans `.local/persona/`.
