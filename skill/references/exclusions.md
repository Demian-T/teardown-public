# Exclusions et déduplication

Objectif: qu'un teardown de 60 écrans contienne 60 écrans **différents**. Un dossier
rempli de 50 variantes du même gabarit d'article de blog ne sert à rien.

Les règles vivent dans `lib/teardown/classify.mjs`. Ce fichier explique
le raisonnement ; le code fait autorité.

---

## Quatre verdicts par URL

| Verdict | Effet |
|---|---|
| `capture` | Page chargée et capturée |
| `sample` | Item de listing: deux exemplaires par gabarit, pas plus |
| `index-only` | Page comptée dans le sitemap, jamais chargée |
| `skip` | Jamais chargée, jamais comptée |

## Écarté systématiquement (`skip`)

**Juridique.** Conditions générales, CGV, CGU, mentions légales, confidentialité,
cookies, DPA, RGPD, sous-traitants, usage acceptable, SLA, EULA, remboursement,
déclaration d'accessibilité. En français comme en anglais.

**Erreurs et technique.** 404, 500, pages d'erreur, maintenance, `/cdn-cgi`, `wp-admin`,
`wp-json`, `xmlrpc`.

**Sorties de session.** Déconnexion, désabonnement. Les charger aurait un effet de bord:
c'est la seule catégorie exclue pour une raison de sûreté et pas de pertinence.

**Fichiers et flux.** Images, PDF, archives, vidéos, polices, CSS, JS, RSS, Atom, JSON,
XML, CSV.

## Gardé en index seulement (`index-only`)

Le contenu éditorial: blog, actualités, presse, articles, documentation, référence
d'API, centre d'aide, base de connaissances, tutoriels, guides, changelog, notes de
version, feuille de route, carrières, événements, communauté.

**La page d'index de chaque section est capturée** (`/blog`, `/docs`, `/changelog`), son
contenu ne l'est pas. On voit ainsi comment ils présentent leur documentation, sans
récupérer 300 articles.

Décision prise avec Demian: ces sections sont hors du périmètre par défaut. Pour les
inclure sur un produit précis, éditer `INDEX_ONLY` dans `classify.mjs`.

## Échantillonné (`sample`)

Les listings à forte densité qui restent des surfaces produit: intégrations,
applications, marketplace, extensions, modèles, galeries, exemples, clients, études de
cas, témoignages.

L'index est capturé, plus deux items maximum. Assez pour voir le gabarit, pas assez pour
noyer le dossier.

## Déduplication par gabarit

Deux URLs partagent un gabarit quand leurs chemins se ramènent à la même signature. Les
segments dynamiques sont remplacés par `:seg`. Un segment est jugé dynamique s'il est
entièrement numérique, s'il ressemble à un UUID ou à une empreinte, s'il dépasse 24
caractères, ou s'il fait au moins 12 caractères avec au moins deux tirets (la forme
typique d'un slug d'article).

Ainsi `/blog/comment-faire-un-truc` et `/blog/pourquoi-machin-marche` deviennent tous
deux `/blog/:seg`. **Deux captures maximum par gabarit.**

## Plafond par section

L'heuristique ci-dessus ne voit pas les slugs courts: `/method/intro`, `/method/plan` et
`/method/build` forment chacun leur propre gabarit et passeraient tous les trois. Sur
Linear, ça remplissait un tiers du teardown avec une seule rubrique.

D'où un second garde-fou, indépendant: **six écrans maximum par section de premier
niveau**, appliqué uniquement aux chemins d'au moins deux segments. `/pricing` et
`/features` ne sont donc jamais concernés, mais `/method/*` s'arrête à six.

Les listings (`sample`) gardent leur propre plafond, plus strict: deux par section.

## Déduplication par rendu

Les deux filtres qui suivent regardent ce que le navigateur affiche, pas ce que l'URL
promet. Sans eux, une application monopage fausse tout le teardown.

**Soft-404.** Avant le crawl, le script demande une URL volontairement inexistante et
retient l'empreinte de la réponse (titre, premier titre de niveau 1, longueur et début
du texte). Toute page dont le rendu correspond à cette empreinte est écartée. C'est
indispensable: une SPA répond 200 sur n'importe quelle URL, souvent avec son écran de
connexion.

**Mur de connexion.** Une page courte dont le texte parle de connexion, rencontrée
ailleurs que sur une page d'authentification, est écartée et comptée. Le compteur
s'affiche en fin de run et déclenche la suggestion de lancer `teardown:login`.

La vraie page de connexion, elle, est capturée: elle appartient au parcours
d'acquisition.

**Rendus jumeaux.** Deux pages qui affichent le même titre, le même titre de niveau 1,
le même début de texte et une longueur à 40 caractères près sont considérées comme un
doublon. La seconde est écartée en citant la première.

## Traçabilité

Tout ce qui est écarté figure dans `sitemap.json`, champ `skipped`, avec son motif. Rien
ne disparaît en silence: si une page manque, le fichier dit pourquoi.
