# Format du persona

Le JSON version 1 décrit un scénario complet. Les champs requis sont ceux du modèle
`../assets/persona.template.json`.

| Champ | Usage |
|---|---|
| `id`, `name` | Identifiant technique et nom lisible du profil |
| `context`, `goal` | Situation et tâche à accomplir, formulées sans indiquer le chemin |
| `profile.digitalExperience` | Expérience numérique explicitement choisie |
| `profile.priorKnowledge` | Ce que la personne sait en arrivant, y compris « aucune connaissance » |
| `behavior.reading` | Ce qu’elle lit, survole ou cherche en premier |
| `behavior.navigation` | Manière de choisir les liens, d’utiliser les menus et la recherche |
| `behavior.decisionCriteria` | Informations qui permettent de choisir une offre ou de poursuivre |
| `behavior.avoidances` | Ce qui la fait hésiter ou quitter le parcours selon le scénario |
| `behavior.recovery` | Ce qu’elle fait en cas d’incompréhension : revenir, essayer un autre menu, abandonner |
| `scenario.startUrl` | URL de départ HTTP(S), sans identifiants intégrés |
| `scenario.allowedOrigins` | Liste exacte des origines permises, par exemple `https://example.com` |
| `scenario.device` | `desktop` (viewport 1440 × 900) ou `mobile` (390 × 844) |
| `scenario.maxActions` | Budget de 1 à 100, arrivée comprise |
| `scenario.maxMinutes` | Budget réel d’automatisation de 1 à 120 minutes |
| `scenario.maxConsecutiveFailures` | Arrêt après ce nombre d’actions échouées de suite |
| `scenario.allowFormInput` | Autorise uniquement la saisie fictive ; l’envoi reste exclu |
| `scenario.successCriteria` | Liste de `{id, label}` : preuves observables et vérifiables |
| `assumptions` | Hypothèses ajoutées par le testeur, à distinguer des faits fournis |

Les champs de contexte supplémentaires (âge, métier, langue, besoins d’accessibilité
déclarés) peuvent être ajoutés à `profile`. Ils n’activent aucun comportement implicite.
Un niveau d’expertise ou une stratégie de navigation doit toujours être écrit.

Le mode mobile du navigateur local modifie le viewport. Ce n’est pas un téléphone réel,
et il ne simule pas automatiquement les capacités motrices ou visuelles d’une personne.
Les domaines de redirection doivent être présents dans `allowedOrigins` avant l’essai.
Si un domaine inattendu apparaît, arrêter et modifier le scénario pour un nouvel essai.
