# Guide de configuration - LBC Bot

## 🚀 Installation rapide

### 1. Installer les dépendances

```bash
pnpm install
```

### 2. Configurer l'environnement

Copier `.env.example` vers `.env` et remplir les variables :

```bash
cp .env.example .env
```

Variables requises :
- `DATABASE_URL` : URL PostgreSQL Supabase
- `OPENAI_API_KEY` : Clé API OpenAI
- `RESEND_API_KEY` : Clé API Resend pour les emails
- `NOTIFICATION_EMAIL_FROM` : Email expéditeur
- `NOTIFICATION_EMAIL_TO` : Email de Marika
- `CRON_SECRET` : Secret pour sécuriser les cron jobs (générer un UUID)


### 3. Initialiser la base de données

```bash
pnpm db:push
```

### 4. Insérer les données initiales (seed)

```bash
pnpm db:seed
```

Cela va créer 3 recherches d'exemple :
- ✅ Montres vintage (active)
- ✅ Appareils photo argentiques (active)
- ⏸️ Vélos vintage Paris (inactive)

Tu peux modifier le fichier `prisma/seed.ts` pour ajouter tes propres recherches.

## 📋 Utilisation

### Mode manuel (CLI)

```bash
pnpm scrape
pnpm analyze
pnpm notify
```

### Mode automatique (Vercel Cron)

Une fois déployé sur Vercel, les crons s'exécutent automatiquement :
- Scraping : toutes les 2 heures (`0 */2 * * *`)
- Analyse : toutes les heures à :15 (`15 */1 * * *`)
- Notification : tous les jours à 9h00 (`0 9 * * *`)

Configuration dans `vercel.json`

### Interface web

```bash
pnpm dev
```

Accéder à `http://localhost:3000`

## 🧪 Test manuel

### 1. Tester le scraping

```bash
pnpm scrape
```

Devrait afficher le nombre d'annonces trouvées.

### 2. Tester l'analyse IA

```bash
pnpm analyze
```

Devrait analyser les annonces et calculer les scores.

### 3. Tester l'envoi d'email

```bash
pnpm notify
```

Devrait envoyer un email avec les bonnes affaires.

## 🔍 Déboguer

### Voir les logs

Les logs sont dans le dossier `logs/` :
- `combined.log` : tous les logs
- `error.log` : uniquement les erreurs

### Base de données

Utiliser Prisma Studio pour explorer la base :

```bash
pnpm db:studio
```

## 🎯 Architecture

Le projet suit une **Clean Architecture** :

```
src/
├── domain/           # Entités et logique métier
├── application/      # Use cases (orchestration)
├── infrastructure/   # Implémentations externes
│   ├── prisma/      # Repositories
│   ├── scraping/    # Playwright
│   ├── ai/          # OpenAI
│   ├── mail/        # Resend
│   └── storage/     # Stockage images
└── app/             # Next.js (UI + API)
```

## 🔄 Changer de provider IA

Pour utiliser Claude au lieu d'OpenAI, créer une nouvelle implémentation :

```typescript
// src/infrastructure/ai/ClaudeePriceEstimationService.ts
export class ClaudePriceEstimationService implements IPriceEstimationService {
  // Implémentation avec Claude API
}
```

Puis mettre à jour le container :

```typescript
// src/infrastructure/di/container.ts
this.priceEstimationService = new ClaudePriceEstimationService(...)
```

## 📦 Déploiement

### Vercel (Recommandé)

1. **Push sur GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin your-repo-url
   git push -u origin main
   ```

2. **Connecter à Vercel**
   - Aller sur [vercel.com](https://vercel.com)
   - Import le projet depuis GitHub
   - Configurer les variables d'environnement :
     - `DATABASE_URL`
     - `OPENAI_API_KEY`
     - `RESEND_API_KEY`
     - `NOTIFICATION_EMAIL_FROM`
     - `NOTIFICATION_EMAIL_TO`
     - `CRON_SECRET` (générer avec `openssl rand -base64 32`)
     - `MIN_GOOD_DEAL_SCORE` (optionnel, défaut: 60)
     - `NODE_ENV=production`

3. **Déployer**
   - Vercel détecte automatiquement `vercel.json`
   - Les cron jobs sont activés automatiquement
   - Vercel ajoutera automatiquement le header `Authorization: Bearer ${CRON_SECRET}`

4. **Vérifier les crons**
   - Dans le dashboard Vercel : Settings > Cron Jobs
   - Voir les logs : Deployments > Logs

### Alternative : Railway / Render

Si vous n'utilisez pas Vercel, vous pouvez :
1. Déployer l'app Next.js normalement
2. Utiliser un service externe pour les crons (cron-job.org, EasyCron, etc.)
3. Configurer les crons pour appeler :
   - `https://your-domain.com/api/cron/scrape`
   - `https://your-domain.com/api/cron/analyze-and-notify`
   - `https://your-domain.com/api/cron/cleanup`
   - `https://your-domain.com/api/cron/learn-feedback`
4. Ajouter le header `Authorization: Bearer ${CRON_SECRET}`

## ❓ Questions fréquentes

**Q : Le scraping ne trouve pas d'annonces**
R : Vérifier que l'URL de recherche est correcte et que Le Bon Coin n'a pas changé sa structure HTML.

**Q : L'analyse IA échoue**
R : Vérifier la clé API OpenAI et que les images sont bien téléchargées.

**Q : Les emails ne sont pas envoyés**
R : Vérifier la clé API Resend et les adresses email.

## 🛠️ Développement

### Ajouter une nouvelle fonctionnalité

1. Créer l'entité dans `domain/entities/`
2. Créer le repository interface dans `domain/repositories/`
3. Implémenter le repository dans `infrastructure/prisma/repositories/`
4. Créer le use case dans `application/use-cases/`
5. Ajouter au container

### Tests

```bash
pnpm test
```

## 📝 License

ISC

