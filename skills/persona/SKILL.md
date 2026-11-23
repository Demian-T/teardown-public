---
name: persona
description: >
  Crée un persona comportemental et simule son parcours sur un site réel, une action
  observée à la fois, avec un navigateur local ou un agent comme Claude in Chrome.
  Utiliser pour /persona, tester un parcours client selon un profil ou comparer des
  scénarios utilisateurs. Les profils et résultats restent locaux, hors Git.
---

# Persona et parcours utilisateur

L’objectif est d’observer ce que le persona peut trouver et accomplir depuis son point
d’entrée, avec sa méthode de lecture et de décision. Le crawler `/teardown` reste utile
pour l’inventaire global ; ne pas donner sa carte au persona pendant la simulation.

## Définir le scénario

Transformer le besoin en objectif concret et en critères observables : par exemple
trouver une offre pertinente, lire une condition donnée, atteindre un formulaire.
Un clic sur « Devis » ne prouve pas qu’un devis est obtenu ou qu’un achat est réalisé.

Définir l’expérience numérique, les connaissances préalables, la façon de lire,
les indices recherchés, les critères de choix, les évitements et la réaction prévue
en cas de difficulté. L’âge et le genre peuvent faire partie du contexte fourni, mais
ne suffisent pas à déduire ces comportements. Marquer les hypothèses ajoutées. Ne pas
inventer de handicap, de peur ou de difficulté parce qu’une personne est âgée.

Dans la racine du dépôt :

```bash
npm run persona -- create identifiant-du-persona
```

Compléter le JSON créé dans `.local/persona/personas/`, puis :

```bash
npm run persona -- validate .local/persona/personas/identifiant-du-persona.json
npm run persona -- start .local/persona/personas/identifiant-du-persona.json --provider=playwright
```

Lire [references/persona-format.md](references/persona-format.md) pour les champs et
les critères. Le modèle générique est dans `assets/persona.template.json` ; aucun
persona concret de test ne doit être ajouté aux fichiers versionnés.

## Choisir le navigateur

- Navigateur local : lire [references/local-browser.md](references/local-browser.md).
  Le CLI ouvre un profil Chrome neuf par essai, expose l’écran visible et exécute les
  actions choisies par l’agent. Il ne demande ni clé de modèle ni API d’IA.
- Claude in Chrome, Aside, navigateur Codex ou agent browser-use : lire
  [references/browser-adapters.md](references/browser-adapters.md). Le brief portable
  est généré par `start`. Ces modes utilisent les outils déjà disponibles dans l’agent
  choisi ; le dépôt n’installe pas d’extension et n’invente pas de connecteur.

Respecter le choix du navigateur de l’utilisateur. Garder une session neuve par persona
si l’outil le permet ; sinon consigner que les cookies, la session ou les recommandations
sont partagés. Ne pas remplacer un moteur absent sans signaler le changement.

## Simuler et observer

1. Partir de `scenario.startUrl`. Lire le brief figé de l’essai.
2. Observer l’écran réellement visible, puis choisir une action cohérente avec le
   persona. Faire défiler la page pour découvrir ce qui se trouve plus bas. Ne pas
   deviner une URL, inspecter le code ou rechercher une route cachée.
3. Consigner avant/après, capture, raison, attente et résultat. Un échec, un retour en
   arrière et un abandon font partie du résultat. Revoir l’écran après chaque action.
4. Respecter les origines et les budgets du scénario. À un lien extérieur, un captcha,
   une connexion nécessaire ou une action de validation, consigner la limite atteinte.
5. Arrêter quand l’objectif est atteint, que le persona abandonnerait selon son scénario,
   ou que son budget est épuisé. Ne pas chercher une autre solution avec l’expertise du
   testeur pour forcer une réussite.

Pas d’envoi de formulaire, de création de compte, d’achat, de message ou de suppression
dans ce workflow. La saisie de données fictives, sans validation, exige
`scenario.allowFormInput: true`. Une vraie transaction sort de ce test et nécessite une
instruction distincte de l’utilisateur.

## Terminer et comparer

Renseigner chaque critère avec `met`, une preuve et les numéros d’étape ; un critère
non trouvé reste faux. `success` exige tous les critères remplis. Utiliser `partial`,
`blocked` ou `abandoned` si nécessaire. Exécuter `finish`, puis `compare` pour plusieurs
essais ; les commandes exactes sont dans la référence du navigateur.

Restituer les parcours observés et leurs preuves séparément des interprétations. Les
durées sont celles de l’automatisation. Un persona simulé n’est pas un utilisateur
recruté ; trois simulations ne donnent ni taux de conversion ni conclusion sur une
population. Signaler les effets de session, les hypothèses et toute connaissance
préalable du site par le testeur.

Avant de publier le code : `npm run check:private` et vérifier les fichiers indexés.
Les personas, briefs remplis, captures, journaux, profils et rapports restent dans
`.local/persona/` (ou dans une copie de livrable locale hors du dépôt).
