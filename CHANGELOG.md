# Changelog

## [1.0.0] - Migration Next.js 16 + Vercel Cron

### ✅ Changements majeurs

#### 🆙 Mise à jour vers Next.js 16
- **Next.js** : 15.0.3 → 16.0.4
- **React** : 18.3.1 → 19.2.0
- **React DOM** : 18.3.1 → 19.2.0
- **@types/react** : 18.3.12 → 19.2.7
- **@types/react-dom** : 18.3.1 → 19.2.3
- **eslint-config-next** : 15.0.3 → 16.0.4

#### 🔄 Migration de node-cron vers Vercel Cron Jobs

**Suppressions :**
- ❌ `node-cron` (package)
- ❌ `@types/node-cron` (devDependency)
- ❌ `src/infrastructure/scheduler/CronScheduler.ts`
- ❌ `src/cli/scheduler.ts`
- ❌ Script `pnpm scheduler`

**Ajouts :**
- ✅ `vercel.json` - Configuration des cron jobs
- ✅ `src/app/api/cron/scrape/route.ts` - Route cron pour scraping
- ✅ `src/app/api/cron/analyze/route.ts` - Route cron pour analyse
- ✅ `src/app/api/cron/notify/route.ts` - Route cron pour notifications
- ✅ Variable d'environnement `CRON_SECRET` pour sécuriser les routes

### 📋 Configuration des Crons

Les crons s'exécutent automatiquement sur Vercel :

| Tâche | Fréquence | Cron Expression |
|-------|-----------|-----------------|
| Scraping | Toutes les 2h | `0 */2 * * *` |
| Analyse IA | Toutes les heures à :15 | `15 */1 * * *` |
| Notifications | Tous les jours à 9h | `0 9 * * *` |

### 🔒 Sécurité

Les routes cron sont protégées par un secret :
```typescript
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Vercel ajoute automatiquement ce header lors de l'exécution des crons.

### 📄 Documentation

Nouveaux fichiers de documentation :
- **VERCEL_CRON.md** : Guide complet sur les cron jobs Vercel
- **CHANGELOG.md** : Ce fichier

Fichiers mis à jour :
- **README.md** : Mise à jour tech stack et instructions
- **SETUP.md** : Mise à jour déploiement et configuration
- **src/app/page.tsx** : Mise à jour de l'UI pour refléter les changements

### 🚀 Migration depuis node-cron

Si vous utilisiez `pnpm scheduler`, voici les changements :

**Avant :**
```bash
pnpm scheduler  # Lance node-cron en local
```

**Après :**
```bash
# Les crons s'exécutent automatiquement sur Vercel
# Pour tester en local :
curl -X GET http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer your-secret"
```

### ⚠️ Breaking Changes

1. **Suppression du scheduler local**
   - Le script `pnpm scheduler` n'existe plus
   - Les crons ne s'exécutent que sur Vercel (ou via appels HTTP externes)

2. **Nouvelle variable d'environnement requise**
   - `CRON_SECRET` doit être ajoutée (générer avec `openssl rand -base64 32`)

3. **React 19**
   - Mise à jour vers React 19 (peut nécessiter des ajustements si vous ajoutez des composants complexes)

### 📦 Déploiement

Pour déployer avec les crons :

1. Ajouter `CRON_SECRET` dans les variables d'environnement Vercel
2. Push le code (avec `vercel.json`)
3. Les crons sont automatiquement détectés et configurés
4. Vérifier dans Settings > Cron Jobs du dashboard Vercel

### 🧪 Test

**Test des routes cron en local :**
```bash
pnpm dev

# Dans un autre terminal
export CRON_SECRET="your-secret"

curl -X GET http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Test des scripts CLI (inchangé) :**
```bash
pnpm scrape   # Fonctionne toujours
pnpm analyze  # Fonctionne toujours
pnpm notify   # Fonctionne toujours
```

### 💡 Avantages de Vercel Cron

✅ **Simplicité** : Pas de serveur cron à gérer  
✅ **Fiabilité** : Infrastructure Vercel  
✅ **Monitoring** : Logs intégrés dans le dashboard  
✅ **Scalabilité** : S'adapte automatiquement  
✅ **Coût** : Inclus dans le plan Vercel Pro  

### 🔗 Ressources

- [Documentation Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Next.js 16 Release Notes](https://nextjs.org/blog/next-16)
- [React 19 Release Notes](https://react.dev/blog/2024/12/05/react-19)

