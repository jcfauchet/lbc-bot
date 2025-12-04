# Configuration des Proxies Rotatifs

Ce système permet d'utiliser des proxies rotatifs **uniquement pour LeBonCoin** (API et scraper Playwright) pour contourner DataDome.

## 🎯 Utilisation

Les proxies sont utilisés **uniquement** pour :
- ✅ `LeBonCoinApiClient` (requêtes API)
- ✅ `LeBonCoinListingScraper` (scraping Playwright)

Les autres scrapers (Pamono, 1stdibs, Selency, etc.) **n'utilisent pas** les proxies.

## 📋 Configuration

### 1. Variables d'environnement

Ajoutez ces variables dans votre `.env` et dans Vercel :

```bash
# Activer les proxies
PROXY_ENABLED=true

# Liste des proxies (séparés par des virgules)
# Format: http://username:password@host:port ou http://host:port
PROXY_LIST=http://proxy1.example.com:8080,http://user:pass@proxy2.example.com:3128,https://proxy3.example.com:443
```

### 2. Formats de proxy supportés

- **HTTP** : `http://host:port`
- **HTTP avec auth** : `http://username:password@host:port`
- **HTTPS** : `https://host:port`
- **HTTPS avec auth** : `https://username:password@host:port`

### 3. Exemples

```bash
# Proxies simples
PROXY_LIST=http://proxy1.com:8080,http://proxy2.com:8080

# Proxies avec authentification
PROXY_LIST=http://user1:pass1@proxy1.com:8080,http://user2:pass2@proxy2.com:3128

# Mix de formats
PROXY_LIST=http://proxy1.com:8080,https://user:pass@proxy2.com:443
```

## 🔄 Fonctionnement

### Rotation automatique
- Les proxies sont utilisés en rotation (round-robin)
- Chaque requête utilise un proxy différent
- En cas d'échec, le proxy est marqué comme défaillant
- Après 3 échecs, le proxy est temporairement exclu
- Tous les proxies sont réinitialisés si tous échouent

### Gestion des erreurs
- Si un proxy échoue, on passe automatiquement au suivant
- Les proxies défaillants sont temporairement ignorés
- Les succès réinitialisent le compteur d'échecs

## 🛠️ Services de proxy recommandés

### Services gratuits (limités)
- **Free Proxy List** : https://free-proxy-list.net/
- **ProxyScrape** : https://proxyscrape.com/

### Services payants (recommandés pour production)
- **Bright Data** (ex-Luminati) : https://brightdata.com/
- **Oxylabs** : https://oxylabs.io/
- **Smartproxy** : https://smartproxy.com/
- **IPRoyal** : https://iproyal.com/

## ⚠️ Notes importantes

1. **Performance** : Les proxies peuvent ralentir les requêtes
2. **Fiabilité** : Les proxies gratuits sont souvent instables
3. **Sécurité** : Utilisez uniquement des proxies de confiance
4. **Coûts** : Les proxies payants peuvent avoir des coûts selon le trafic

## 🔍 Debugging

Les logs indiquent :
- `🌐 [LeBonCoin API] Proxy rotation enabled with X proxies`
- `🔄 [LeBonCoin API] Using proxy X/Y: host:port`
- `⚠️ Proxy X marked as failed (N failures)`

## 📝 Exemple de configuration complète

```bash
# .env
PROXY_ENABLED=true
PROXY_LIST=http://proxy1.example.com:8080,http://user:pass@proxy2.example.com:3128,https://proxy3.example.com:443
```

