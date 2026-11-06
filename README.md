# teardown

Démonte un produit web à partir de son URL : arborescence réelle, captures desktop et mobile de chaque écran significatif, parcours utilisateur, stack et design tokens. Le résultat tient dans un dossier daté, avec une galerie HTML navigable.

Le crawl navigue et observe. Il ne soumet aucun formulaire et ne crée ni ne supprime rien sur le site analysé, sauf avec `--try-create`, qui autorise le clic sur un bouton "Nouveau".

## Prérequis

- Node.js (testé avec la version 25.2.1).
- Google Chrome. Le chemin par défaut est celui de macOS. La variable `CHROME_BIN` permet d'en indiquer un autre.
- `cwebp`, facultatif : sans lui, les captures restent en PNG et pèsent beaucoup plus lourd (`brew install webp`).

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
