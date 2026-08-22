# Configuration des Cron Jobs Vercel

Ce projet utilise les **Vercel Cron Jobs** pour automatiser les tâches périodiques.

## 📋 Cron Jobs configurés

Les crons sont définis dans `vercel.json` :

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape",
      "schedule": "0 */2 * * *"
    },
    {
      "path": "/api/cron/analyze-and-notify",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 0 * * 0"
    },
    {
      "path": "/api/cron/learn-feedback",
      "schedule": "0 3 * * *"
    }
  ]
}
```

### Tâches programmées

| Tâche | Route | Fréquence | Description |
|-------|-------|-----------|-------------|
| **Scraping** | `/api/cron/scrape` | Toutes les 2 h | Scrape les annonces Le Bon Coin |
| **Analyse And Notify** | `/api/cron/analyze-and-notify` | Toutes les 15 minutes | Préfiltre, trie, estime la valeur et envoie les notifications |
| **Cleanup** | `/api/cron/cleanup` | Dimanche à minuit | Supprime les annonces ignorées de plus de 14 jours |
| **Learn Feedback** | `/api/cron/learn-feedback` | Tous les jours à 3 h | Distille le feedback en règles de triage |

## 🔒 Sécurité

Les routes cron sont protégées par un secret :

```typescript
const authHeader = request.headers.get('authorization')

if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### Générer un CRON_SECRET

```bash
openssl rand -base64 32
```

Ajouter cette valeur dans les variables d'environnement Vercel :
- Variable : `CRON_SECRET`
- Value : le secret généré

## 🚀 Déploiement

1. **Push le code sur GitHub** avec `vercel.json`

2. **Déployer sur Vercel**
   - Vercel détecte automatiquement le fichier `vercel.json`
   - Les crons sont créés automatiquement

3. **Vérifier dans le dashboard Vercel**
   - Aller dans **Settings > Cron Jobs**
   - Vous devriez voir les 3 crons configurés

4. **Voir les logs**
   - **Deployments > Logs**
   - Filtrer par `/api/cron/*`

## ⏱️ Syntaxe Cron

Format : `minute hour day month dayOfWeek`

Exemples :
- `0 */2 * * *` = Toutes les 2 heures (minute 0)
- `15 */1 * * *` = Toutes les heures à la minute 15
- `0 9 * * *` = Tous les jours à 9h00
- `*/30 * * * *` = Toutes les 30 minutes
- `0 0 * * 0` = Tous les dimanches à minuit

## 🧪 Test local

Pour tester les routes cron en local :

```bash
# Terminal 1 : Lancer le serveur
pnpm dev

# Terminal 2 : Appeler les routes avec curl
curl -X GET http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer your-secret-key"

curl -X GET http://localhost:3000/api/cron/analyze-and-notify \
  -H "Authorization: Bearer your-secret-key"
```

## 🔧 Modification des horaires

Pour changer les horaires, éditer `vercel.json` :

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape",
      "schedule": "0 */4 * * *"  // Toutes les 4h au lieu de 2h
    }
  ]
}
```

Puis redéployer sur Vercel.

## ⏸️ Désactiver temporairement un cron

Deux options :

### Option 1 : Via le dashboard Vercel
- Settings > Cron Jobs
- Toggle pour désactiver un cron spécifique

### Option 2 : Commenter dans vercel.json
```json
{
  "crons": [
    // {
    //   "path": "/api/cron/scrape",
    //   "schedule": "0 */2 * * *"
    // }
  ]
}
```

## 📊 Monitoring

Chaque exécution de cron :
1. Enregistre des logs avec Winston (fichier `logs/combined.log`)
2. Retourne un JSON avec le résultat
3. Affiche dans les logs Vercel

Exemple de réponse :
```json
{
  "success": true,
  "data": {
    "totalSearches": 2,
    "newListings": 5,
    "updatedListings": 12
  },
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

## 🚨 Gestion des erreurs

Si un cron échoue :
1. L'erreur est loggée dans `logs/error.log`
2. Vercel affiche l'erreur dans les logs
3. Le cron sera réessayé à la prochaine exécution programmée

Les crons ont un **maxDuration de 300s** (5 minutes) pour éviter les timeouts.

## ⚡ Limites Vercel

- **Hobby plan** : 1 cron max par jour
- **Pro plan** : Crons illimités
- **Durée max** : 5 minutes par exécution
- **Timeout** : Configurable avec `maxDuration`

Si vous avez besoin de plus de flexibilité, envisager :
- Upgrade vers Pro
- Utiliser un service externe (EasyCron, cron-job.org)
- Railway/Render avec crons natifs

## 🔗 Ressources

- [Documentation Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Crontab Guru](https://crontab.guru/) - Générateur de syntaxe cron

