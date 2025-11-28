# Configuration Playwright pour Vercel

Pour que les scrapers fonctionnent sur Vercel, il faut configurer Chromium correctement.

## ⚠️ Important

Vercel interdit explicitement le scraping selon leur politique d'utilisation. Cette configuration est fournie à titre informatif pour des environnements de développement ou des cas d'usage autorisés.

## Configuration

### Option 1 : Utiliser un Chromium pré-compilé (Recommandé)

1. **Installer `playwright-core` au lieu de `playwright`** (optionnel, mais réduit la taille) :
```bash
pnpm remove playwright
pnpm add playwright-core
pnpm add -D @playwright/test
```

2. **Ajouter un script de build dans `package.json`** :
```json
{
  "scripts": {
    "postinstall": "playwright install chromium"
  }
}
```

3. **Configurer Vercel pour installer Chromium** :
   - Dans les **Settings > Build & Development Settings** de votre projet Vercel
   - Ajoutez la variable d'environnement : `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0`

### Option 2 : Utiliser un service externe (Browserless)

Si vous préférez utiliser un service externe pour le scraping :

1. Créer un compte sur [Browserless.io](https://www.browserless.io/) ou auto-héberger
2. Modifier `src/infrastructure/scraping/playwright-config.ts` pour utiliser `chromium.connect()` :

```typescript
export async function createBrowserForVercel(): Promise<Browser> {
  const browserlessUrl = process.env.BROWSERLESS_URL;
  
  if (browserlessUrl) {
    return await chromium.connect(browserlessUrl);
  }
  
  // Fallback vers local
  return await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}
```

3. Ajouter la variable d'environnement `BROWSERLESS_URL` dans Vercel

### Option 3 : Utiliser Puppeteer avec @sparticuz/chromium

Alternative plus légère pour Vercel :

```bash
pnpm remove playwright
pnpm add puppeteer-core @sparticuz/chromium
```

## Variables d'environnement Vercel

Ajoutez ces variables dans **Settings > Environment Variables** :

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` : (Optionnel) Chemin vers l'executable Chromium si pré-installé
- `VERCEL` : Automatiquement défini par Vercel (pas besoin de le configurer)

## Limitations Vercel

- **Durée max** : 5 minutes (configuré dans `vercel.json`)
- **Mémoire** : Limite selon le plan (Hobby: 1GB, Pro: 1GB, Enterprise: variable)
- **Politique** : Le scraping est interdit par Vercel

## Alternative recommandée

Pour des scrapers en production, considérez :
- **Render** : Supporte les processus long terme
- **Railway** : Environnement plus flexible
- **AWS Lambda** : Avec Layer Chromium
- **Docker** : Auto-hébergement sur un VPS

## Test local

Pour tester la configuration localement :

```bash
# Simuler l'environnement Vercel
VERCEL=1 pnpm dev

# Ou tester directement les scrapers
pnpm scrape:references
```

