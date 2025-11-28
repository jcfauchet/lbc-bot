# Configuration Cloudinary

Pour utiliser Cloudinary au lieu du stockage local (nécessaire pour Vercel), suivez ces étapes :

## 1. Créer un compte Cloudinary

1. Allez sur [cloudinary.com](https://cloudinary.com)
2. Créez un compte gratuit (25GB de stockage, 25GB de bande passante/mois)
3. Récupérez vos credentials depuis le Dashboard

## 2. Variables d'environnement

Ajoutez ces variables dans votre `.env` et dans Vercel :

```bash
STORAGE_TYPE=cloudinary
CLOUDINARY_CLOUD_NAME=votre_cloud_name
CLOUDINARY_API_KEY=votre_api_key
CLOUDINARY_API_SECRET=votre_api_secret
```

## 3. Avantages

- ✅ **Fonctionne sur Vercel** : Pas besoin d'écrire localement
- ✅ **Moins de tokens** : Les URLs sont utilisées directement au lieu de base64
- ✅ **URLs stables** : Les images sont hébergées de manière permanente
- ✅ **CDN intégré** : Cloudinary optimise et sert les images rapidement
- ✅ **Gratuit** : 25GB de stockage et 25GB de bande passante/mois

## 4. Comment ça marche

1. Lors de l'analyse IA, les images sont uploadées sur Cloudinary
2. Les URLs Cloudinary sont stockées dans `pathLocal` de la base de données
3. Ces URLs sont envoyées directement à l'IA (OpenAI/Gemini accepte les URLs publiques)
4. **Résultat** : Beaucoup moins de tokens consommés qu'avec base64 !

## 5. Comparaison des tokens

- **Base64** : ~85 tokens par image (selon la taille)
- **URL** : ~1 token par image
- **Économie** : ~98% de tokens en moins ! 🎉

## 6. Fallback local

Si `STORAGE_TYPE=local`, le système utilise toujours le stockage local pour le développement.

