# teardown

Démonte un produit web à partir de son URL : arborescence réelle, captures desktop et mobile de chaque écran significatif, parcours utilisateur, stack et design tokens. Le résultat tient dans un dossier daté, avec une galerie HTML navigable.

Le crawl navigue et observe. Il ne soumet aucun formulaire et ne crée ni ne supprime rien sur le site analysé, sauf avec `--try-create`, qui autorise le clic sur un bouton "Nouveau".

## Prérequis

- Node.js (testé avec la version 25.2.1).
- Google Chrome. Le chemin par défaut est celui de macOS. La variable `CHROME_BIN` permet d'en indiquer un autre.
- `cwebp`, facultatif : sans lui, les captures restent en PNG et pèsent beaucoup plus lourd (`brew install webp`).
- `ffmpeg`, pour la vidéo des parcours persona (`brew install ffmpeg`). `FFMPEG_BIN` permet d’en préciser le chemin. Le mode `--no-video` n’en a pas besoin.

## Installation

```bash
npm install
```

## Utilisation

```bash
npm run teardown -- https://linear.app
```

| Option | Effet |
|---|---|
| `--mode=quick` | 25 écrans, profondeur 3, 3 à 6 min |
| `--mode=standard` | 60 écrans, profondeur 4, 8 à 15 min (défaut) |
| `--mode=full` | 150 écrans, profondeur 5, 20 à 40 min |
| `--max-pages=N` | Budget d'écrans explicite, prime sur le mode |
| `--ignore-robots` | Ignore robots.txt |
| `--no-mobile` | Desktop seulement |
| `--try-create` | Autorise l'ouverture des modales de création. Sur certains produits, le clic crée l'objet |
| `--headless` | Sans fenêtre visible. Certains sites bouncent le headless |

## Sortie

Chaque run écrit dans `output/<domaine>/<date>/` :

```
sitemap.json       pages capturées, pages écartées et pourquoi
journeys.json      parcours reconstitués, étape par étape
fingerprint.json   stack, services tiers, design tokens
index.html         galerie navigable, bascule desktop / mobile
screens/           captures desktop et mobile
```

`output/INDEX.md` liste les teardowns réalisés. `output/PATTERNS.md` sert de bibliothèque de patterns, remplie à l'analyse.

## Explorer l'intérieur d'une app

Sans session, le crawl ne voit que la vitrine. Pour aller plus loin, une fois par produit :

```bash
npm run teardown:login -- https://linear.app
```

Un vrai Chrome s'ouvre sur un profil dédié au domaine. La connexion se fait à la main et aucun mot de passe ne passe par le script. Les runs suivants réutilisent la session.

Les profils sont dans `.cookies/teardown/<domaine>`. Ils contiennent des sessions connectées : ce dossier est ignoré par git et doit le rester.

## Utilisation par un agent

`skill/SKILL.md` décrit le parcours complet pour un agent : crawl, point de contrôle, puis analyse du rapport selon `skill/references/analysis-grid.md`. Les règles d'exclusion des pages sont expliquées dans `skill/references/exclusions.md`.

## Parcours pilotés par persona

Le skill [`/persona`](skills/persona/SKILL.md) crée un profil comportemental et teste
son objectif sur le site, une action observée à la fois. Il complète le crawl global :
les actions sont choisies par l’agent selon les connaissances et les critères du persona.

```bash
npm run persona -- create mon-persona
# Compléter le JSON créé dans .local/persona/personas/, puis :
npm run persona -- validate .local/persona/personas/mon-persona.json
npm run persona -- start .local/persona/personas/mon-persona.json --provider=playwright
npm run persona -- browser <dossier-essai> --headless
```

Le CLI navigateur reçoit une action JSON par ligne et conserve les captures, les raisons
et les observations avant/après. Il ne choisit pas les actions et ne lance pas de modèle
d’IA. Le skill explique comment l’agent prend ces décisions, termine le bilan et compare
les parcours. Chaque essai local utilise un nouveau profil Chrome.

Le navigateur **enregistre aussi une vidéo MP4 continue par défaut**, dans
`<dossier-essai>/recordings/journey.mp4`. Elle suit le viewport actif, y compris les
animations, les défilements et les nouveaux onglets, sans audio ni capture des autres
applications. Fermer la session avec `{"type":"close"}` ou Ctrl+C finalise le fichier.
Le rapport contient un lecteur et des boutons pour revoir chaque action à son horodatage.
`--no-video` désactive cet enregistrement. Un arrêt forcé du processus peut laisser un
fichier `.part` non finalisé ; il n’est pas présenté comme une vidéo disponible.

Pour **Claude in Chrome**, **Aside**, un navigateur **Codex** ou un agent **browser-use**,
choisir le provider correspondant avec `start`, puis transférer le `BRIEF.md` généré à
l’agent. Les [instructions d’adaptation](skills/persona/references/browser-adapters.md)
décrivent le transfert et l’importation des preuves. Les outils du navigateur choisi
doivent être disponibles ; le dépôt ne les installe pas.

Pour joindre un enregistrement MP4 ou WebM réalisé par un outil externe :

```bash
npm run persona -- attach-video <dossier-essai> --file=<video.mp4>
```

Le fichier est copié dans le dossier privé et ajouté au lecteur du rapport. Aucun
enregistrement n’est fabriqué à partir des captures de parcours déjà terminés.

Les profils concrets, scénarios, briefs remplis, cookies, captures, vidéos et résultats restent
dans `.local/persona/`, **ignoré par Git**. Seuls le skill, le modèle vide et le code sont
versionnés. Avant publication : `npm run check:private`. Les simulations décrivent des
hypothèses de comportement ; elles ne remplacent pas des tests avec des utilisateurs.

Les liens de projet `.claude/skills/persona` et `.agents/skills/persona` rendent le même
skill découvrable dans Claude Code (`/persona`) et Codex (`$persona`). Si une copie du
dépôt ne préserve pas les liens symboliques, les recréer depuis sa racine :

```bash
# Claude Code : découverte de /persona dans ce projet
mkdir -p .claude/skills
ln -s ../../skills/persona .claude/skills/persona
# Codex : découverte de $persona dans ce projet
mkdir -p .agents/skills
ln -s ../../skills/persona .agents/skills/persona
```

Claude in Chrome seul reçoit le brief dans la conversation ; il ne charge pas ces
dossiers de projet. `npm test` vérifie le stockage privé, les limites d’action et les
preuves nécessaires aux résultats.

Avec Chrome installé, `RUN_BROWSER_TESTS=1 npm test` vérifie aussi la navigation réelle,
les nouveaux onglets, le viewport et l’arrêt avant une soumission sur un serveur local.
Avec FFmpeg et FFprobe installés, `RUN_BROWSER_TESTS=1 RUN_VIDEO_TESTS=1 npm test` vérifie
également l’animation captée entre deux actions, la durée réelle, le changement d’onglet,
la lecture du MP4 et la finalisation sur interruption du CLI.

Les emplacements de découverte sont décrits dans les documentations officielles
[Claude Code](https://code.claude.com/docs/en/skills) et
[Codex](https://learn.chatgpt.com/docs/build-skills).

## Licence

MIT, voir [LICENSE](LICENSE).
