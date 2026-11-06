---
name: teardown
description: >
  Démonte un produit web pour comprendre comment il est fait: cartographie l'arborescence
  réelle (vitrine ET intérieur de l'app), capture chaque écran significatif en desktop et
  mobile, reconstitue les parcours utilisateur, relève la stack et les design tokens, puis
  rédige une analyse réutilisable. Déclencher sur "/teardown <url>", "analyse ce site",
  "teardown de X", "comment ils ont fait leur onboarding", "mappe les pages de ce SaaS",
  "sitemap de ce site", "récupère les user journeys de X". Sortie dans
  output/. À lancer à la demande: le crawl dure 8 à 15 minutes.
version: 1.0.0
---

# Skill: teardown de produit web

Demian donne une URL. On en ressort une carte complète du produit: ce qu'il contient,
comment on y circule, à quoi ressemble chaque écran, avec quoi c'est construit. Le tout
rangé pour être repioché des mois plus tard, au moment de dessiner un SaaS à lui.

**Rien n'est soumis, créé ni supprimé sur le site analysé.** Le crawl navigue et
observe, il n'écrit pas.

---

## Déroulé en deux temps

Le travail mécanique (crawl, captures, extraction) est fait par un script. Le travail de
lecture (analyse, patterns) est fait par toi, l'agent. Entre les deux, Demian élague.

### Temps 1 — le crawl

```bash
npm run teardown -- https://linear.app
```

Options:

| Option | Effet |
|---|---|
| `--mode=quick` | 25 écrans, profondeur 3, 3 à 6 min |
| `--mode=standard` | 60 écrans, profondeur 4, 8 à 15 min (défaut) |
| `--mode=full` | 150 écrans, profondeur 5, 20 à 40 min |
| `--max-pages=N` | Budget d'écrans explicite, prime sur le mode |
| `--ignore-robots` | Ignore robots.txt (voir "robots.txt" plus bas) |
| `--no-mobile` | Desktop seulement, deux fois plus rapide |
| `--try-create` | Autorise l'ouverture des modales de création (voir "garde-fous") |
| `--headless` | Sans fenêtre visible. Certains sites bouncent le headless |

Le script imprime un résumé et écrit dans
`output/<domaine>/<date>/`:

```
README.md          ← à toi de l'écrire, temps 2
sitemap.json       ← pages capturées, pages écartées et pourquoi
journeys.json      ← parcours reconstitués, étape par étape
fingerprint.json   ← stack, services tiers, design tokens
index.html         ← galerie navigable, bascule desktop / mobile
screens/desktop/   screens/mobile/
```

### Point de contrôle

Rends la main à Demian avec: le nombre d'écrans, les parcours trouvés, la stack, et le
chemin de la galerie. Signale ce qui a été écarté et pourquoi si c'est notable (mur de
connexion, robots.txt, gabarits dupliqués). Il regarde et dit ce qu'il veut jeter.

Ne pas enchaîner sur le temps 2 sans ce point de contrôle: analyser 60 écrans dont la
moitié ne l'intéresse pas est du travail perdu.

### Temps 2 — l'analyse

1. Lire `sitemap.json`, `journeys.json`, `fingerprint.json`.
2. Regarder les captures qui comptent avec l'outil Read, en priorité: home, pricing,
   écran d'inscription, entrée dans l'app, réglages. Les images sont en WebP, Read les
   affiche directement.
3. Rédiger `README.md` en suivant `references/analysis-grid.md`.
4. Reporter les patterns marquants dans `output/PATTERNS.md`, sous la bonne rubrique,
   avec le produit et le lien relatif vers la capture.
5. La ligne d'`INDEX.md` est déjà écrite par le script. Ne pas la refaire à la main.

---

## Session: explorer l'intérieur de l'app

Sans session, le crawl ne voit que la vitrine. Le script le dit et continue.

Pour aller à l'intérieur, une fois par produit:

```bash
npm run teardown:login -- https://linear.app
```

Un vrai Chrome s'ouvre sur un profil dédié à ce domaine. Demian se connecte dedans à la
main: SSO, 2FA, magic link, peu importe, c'est un navigateur normal. Aucun mot de passe
ne passe par le script. La session reste dans le profil
(`.cookies/teardown/<domaine>`, hors git) et tous les runs suivants la
réutilisent.

Un profil par domaine: rester connecté sur dix produits en parallèle ne pose aucun
problème.

Quand le crawl bute sur des écrans de connexion, il le signale en fin de run avec le
nombre de pages concernées. C'est le signal qu'il faut lancer `teardown:login` puis
relancer.

---

## robots.txt

Le crawl respecte robots.txt par défaut, une page à la fois, une seconde entre chaque.

Beaucoup de SaaS y bloquent `/app/*` et `/dashboard/*`. Ces règles visent les robots
d'indexation, pas un utilisateur connecté qui regarde son propre compte. Quand le script
détecte que des zones applicatives ont été écartées pour cette raison, il l'affiche en
fin de run et propose `--ignore-robots`.

**Reporter cette proposition à Demian, ne pas la déclencher soi-même.** C'est son appel,
pas le tien.

---

## Garde-fous

Ce que le crawl s'autorise: naviguer, ouvrir des menus, des panneaux latéraux, des
onglets, dérouler les pages pour déclencher le lazy-load, masquer les bandeaux cookies.

Ce qu'il ne fait jamais: soumettre un formulaire, créer un objet, supprimer quoi que ce
soit, payer, s'inscrire.

`--try-create` est le seul cran au-dessus: il autorise le clic sur un bouton "Nouveau"
pour capturer la modale de création. Il est désactivé par défaut parce que sur certains
produits ce bouton crée l'objet immédiatement au lieu d'ouvrir un formulaire. Le script
détecte ce cas (l'URL change) et abandonne l'étape, mais l'objet est déjà créé. Ne
proposer ce drapeau que sur un produit où Demian accepte de faire le ménage après.

---

## Ce qui est exclu des captures

Détail et règles exactes dans `references/exclusions.md`. En résumé: le juridique (CGV,
CGU, confidentialité, mentions légales), les pages d'erreur, les flux et fichiers, les
articles de blog et les pages de documentation (l'index de chaque section est gardé, pas
son contenu), et tout gabarit déjà capturé deux fois.

Deux filtres supplémentaires tournent sur le rendu, pas sur l'URL: les pages
inexistantes qu'une SPA sert quand même en 200, et les écrans de connexion rencontrés
hors de la page de login. Sans eux, `/app`, `/home` et `/console` se font capturer trois
fois comme trois pages différentes alors qu'ils affichent le même écran.

---

## Dépannage

| Symptôme | Cause probable | Geste |
|---|---|---|
| Une page importante manque, motif "chargement impossible" | Timeout réseau, malgré la seconde tentative automatique | Relancer ; si ça persiste, le site est lent ou limite le débit |
| "Session: non connecté" alors que Demian s'est connecté | Le produit n'expose aucun lien de déconnexion sur la page d'accueil | Sans gravité, la détection est volontairement stricte. Lancer le crawl, il explorera ce qui répond |
| Presque tout finit en "mur de connexion" | Session absente ou expirée | `npm run teardown:login -- <url>` puis relancer |
| Captures en PNG au lieu de WebP, dossier très lourd | `cwebp` absent | `brew install webp` |
| Le site renvoie des pages vides ou un captcha | Anti-bot déclenché par le mode headless | Relancer sans `--headless` |
| Beaucoup de pages écartées en "rendu identique" | Le produit est une SPA qui rend le même écran partout | Vérifier la session ; sinon c'est le comportement attendu |
| Zéro parcours reconstitué | Moins de deux étapes trouvées par parcours | Normal sur une vitrine sans app. Se connecter pour débloquer les parcours app et compte |

---

## Références

- `references/analysis-grid.md` — la grille des quatre axes, et ce qu'on cherche dans chacun
- `references/exclusions.md` — règles d'exclusion et de déduplication
