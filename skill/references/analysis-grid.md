# Grille d'analyse

Quatre axes, plus une section technique. Le rapport est écrit pour un lecteur unique:
Demian, dans six mois, en train de dessiner un écran pour son propre SaaS. Donc:
du concret, des chiffres, des liens vers les captures. Pas de généralités sur
l'importance de l'expérience utilisateur.

Règle de rédaction: **chaque affirmation renvoie à une capture ou à une donnée**. Si
tu ne peux pas montrer où tu l'as vu, ne l'écris pas.

---

## Axe 1 — Architecture et navigation

Ce qu'on cherche: comment le produit range ses écrans, et ce que ce rangement révèle
du modèle mental qu'il impose.

- Combien de sections de premier niveau, et lesquelles ? Comparer avec ce que le
  sitemap annonce: l'écart entre les deux est souvent l'information.
- Quel pattern de navigation: barre latérale, barre supérieure, palette de commandes,
  onglets, fil d'Ariane ? Persistante ou contextuelle ?
- Où vivent les réglages, le profil, la facturation, l'équipe ? Combien de clics depuis
  l'écran d'accueil de l'app ?
- Comment se nomment les objets du produit (issue, doc, projet, espace, base) ? Ce
  vocabulaire est la colonne vertébrale du modèle de données.
- Comment l'arborescence tient-elle quand le nombre d'écrans augmente ? Y a-t-il une
  recherche globale, un raccourci clavier, une navigation par récents ?

## Axe 2 — Parcours et onboarding

L'axe le plus directement copiable. C'est ce qu'on vient chercher.

- Combien d'étapes entre l'arrivée sur la page d'accueil et le premier écran utile ?
  Les compter une par une depuis `journeys.json`.
- L'inscription demande quoi, et dans quel ordre ? Email seul, SSO en premier, carte
  bancaire tout de suite ou jamais ? Le nombre de champs du premier formulaire.
- Y a-t-il un onboarding guidé: checklist, barre de progression, infobulles, données
  d'exemple préremplies, sélection d'un cas d'usage ?
- À quoi ressemblent les états vides ? C'est là que les bons produits se distinguent:
  un état vide qui explique et propose une action, contre un cadre gris et vide.
- Où est le moment où l'utilisateur comprend enfin l'intérêt du produit, et combien de
  temps il met à y arriver ?

## Axe 3 — Conversion et packaging

- Structure de la page d'accueil: que voit-on avant de faire défiler ? Quelle promesse,
  quel visuel, quel appel à l'action ?
- Hiérarchie des appels à l'action: combien de variantes, laquelle domine, où se
  répètent-elles ?
- Preuve sociale: logos clients, chiffres, témoignages, notes. Placée où dans la page ?
- Packaging des offres: combien de plans, quel axe de différenciation (sièges,
  fonctions, volume), quel plan est mis en avant, y a-t-il un gratuit et qu'est-ce qu'il
  bride exactement ?
- Où le produit met-il ses murs payants, et comment les annonce-t-il dans l'interface ?

## Axe 4 — Copy et positionnement

- La promesse principale, citée mot pour mot depuis la capture de la page d'accueil.
- Le registre: on s'adresse à qui, on suppose quoi de connu ?
- Microcopy: libellés de boutons, messages d'état vide, messages d'erreur, textes
  d'aide. Relever les tournures qui font le travail.
- Vocabulaire métier imposé, et cohérence entre la vitrine et l'intérieur de l'app.
  L'écart entre les deux est fréquent et instructif.

## Section technique

Depuis `fingerprint.json`, sans le recopier tel quel:

- Framework, approche CSS, hébergement.
- Services tiers, groupés par usage: analytics, paiement, authentification, support.
  Ce que ce choix dit du niveau de maturité du produit.
- Design tokens qui valent d'être repris: la palette réelle, la ou les familles
  typographiques, l'échelle de tailles, les rayons de bordure, l'échelle d'espacement.
  Le nombre de variables CSS déclarées est un bon indicateur de la maturité du système
  de design.
- Mode sombre présent ou non.

---

## Structure du README.md

```markdown
# Teardown — <produit>

<Date>. <N> écrans capturés, <N> parcours reconstitués, mode <mode>.
Galerie: [index.html](index.html)

## En une phrase
<Ce qu'est le produit et pour qui, tel qu'il se présente lui-même.>

## Ce qui vaut d'être volé
<Trois à cinq points, les plus réutilisables, chacun avec le lien vers la capture.
C'est la seule section que Demian relira systématiquement: la mettre en haut et la
travailler plus que les autres.>

## Architecture et navigation
## Parcours et onboarding
## Conversion et packaging
## Copy et positionnement
## Technique
## Limites de ce teardown
<Ce qui n'a pas été vu et pourquoi: pas de session, robots.txt, budget d'écrans
atteint, zone bloquée. Un teardown honnête sur ses angles morts vaut mieux qu'un
teardown qui laisse croire à l'exhaustivité.>
```

---

## Report dans output/PATTERNS.md

Un pattern ne se reporte que s'il est **transposable**. "Linear a une palette de
commandes" est un pattern. "Linear est joli" n'en est pas un.

Format d'une entrée, sous la rubrique concernée:

```markdown
- **<Nom du pattern>** — <ce qu'il fait, en une phrase, et à quel problème il répond>.
  Vu chez [<produit>](<domaine>/<date>/README.md) · [capture](<domaine>/<date>/<chemin>)
```

Si un pattern déjà présent est retrouvé chez un autre produit, ajouter le produit à
l'entrée existante plutôt que d'en créer une seconde. Une entrée qui accumule quatre
produits est une entrée qui dit "c'est la convention du marché", et c'est exactement
l'information qu'on veut.
