# Flow d'Estimation de Prix - Produits Le Bon Coin

## Schéma du Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    LISTING Le Bon Coin                           │
│              (sans analyse AI, statut: "new")                    │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Téléchargement     │
                    │  des images         │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  PRÉ-ESTIMATION IA  │
                    │  (preEstimate)      │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
         ┌──────────────────┐   ┌──────────────────┐
         │ shouldProceed:   │   │ shouldProceed:   │
         │ false            │   │ true             │
         └────────┬─────────┘   └────────┬─────────┘
                  │                      │
                  ▼                      │
         ┌──────────────────┐           │
         │  Marquer comme   │           │
         │  IGNORED         │           │
         └──────────────────┘           │
                                        │
                                        ▼
                         ┌──────────────────────────┐
                         │  Vérifications           │
                         │  - isPromising?          │
                         │  - hasDesigner?          │
                         │  - searchTerms.length?  │
                         └──────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
         ┌──────────────────┐           ┌──────────────────┐
         │  Non prometteur  │           │  Pas de designer │
         │  ou pas de       │           │  ou pas de       │
         │  searchTerms     │           │  searchTerms     │
         └────────┬─────────┘           └────────┬─────────┘
                  │                               │
                  └───────────┬───────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  Marquer comme   │
                     │  IGNORED         │
                     └──────────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────┐
                         │  SCRAPING PARTENAIRES    │
                         │  (max 4 searchTerms)     │
                         │                          │
                         │  Pour chaque terme:      │
                         │  - AuctionFR             │
                         │  - Pamono                │
                         │  - 1stdibs               │
                         └──────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
         ┌──────────────────┐           ┌──────────────────┐
         │  Aucun produit   │           │  Produits        │
         │  trouvé          │           │  trouvés         │
         └────────┬─────────┘           └────────┬─────────┘
                  │                               │
                  ▼                               ▼
         ┌──────────────────┐           ┌──────────────────┐
         │  Marquer comme   │           │  ESTIMATION     │
         │  IGNORED         │           │  FINALE IA      │
         └──────────────────┘           │  (estimatePrice)│
                                        └────────┬─────────┘
                                                 │
                    ┌───────────────────────────┴──────────────┐
                    │                                           │
                    ▼                                           ▼
         ┌──────────────────┐                       ┌──────────────────┐
         │  Confiance < 80% │                       │  Confiance ≥ 80% │
         └────────┬─────────┘                       └────────┬─────────┘
                  │                                           │
                  ▼                                           ▼
         ┌──────────────────┐                       ┌──────────────────┐
         │  Marquer comme   │                       │  Sauvegarder     │
         │  IGNORED         │                       │  AiAnalysis      │
         └──────────────────┘                       │  + bestMatchSource│
                                                    └────────┬─────────┘
                                                             │
                                                             ▼
                                                    ┌──────────────────┐
                                                    │  Marquer comme   │
                                                    │  ANALYZED        │
                                                    └──────────────────┘
```

## Détails des Étapes

### 1. Pré-Estimation (`preEstimate`)
**Objectif** : Filtrer rapidement et générer des termes de recherche

**Actions** :
- Analyse les images et le titre du produit
- Filtre les "daubes" et produits non gérés
- Fait une pré-estimation de prix
- Détecte si un designer est identifié (certitude ≥ 80%)
- Génère jusqu'à 4 termes de recherche si designer trouvé

**Critères d'arrêt** :
- `shouldProceed: false` → IGNORED
- `isPromising: false` (prix trop bas) → IGNORED
- `hasDesigner: false` ou `searchTerms.length === 0` → IGNORED

### 2. Scraping Partenaires
**Objectif** : Trouver des produits similaires sur les sites de référence

**Sites scrapés** :
- **AuctionFR** : Résultats de ventes aux enchères
- **Pamono** : Marketplace design vintage
- **1stdibs** : Marketplace luxe et design

**Processus** :
- Pour chaque terme de recherche (max 4)
- Pour chaque site partenaire
- Scrape les 5 premiers résultats
- Collecte : titre, prix, images, designer, période, matériau, style

**Critère d'arrêt** :
- Aucun produit trouvé → IGNORED

### 3. Estimation Finale (`estimatePrice`)
**Objectif** : Estimer le prix avec certitude ≥ 80%

**Actions** :
- Compare le produit LBC avec les produits de référence trouvés
- Analyse visuelle des images
- Estime une fourchette de prix (min/max)
- Identifie le meilleur match (partenaire + URL)
- Calcule un niveau de confiance

**Critère d'arrêt** :
- `confidence < 0.8` → IGNORED

### 4. Sauvegarde
**Actions** :
- Crée un `AiAnalysis` avec :
  - Prix estimé (min/max)
  - Marge (prix estimé - prix LBC)
  - Description de l'analyse
  - Confiance
  - **bestMatchSource** (partenaire utilisé)
- Marque le listing comme `ANALYZED`

## Exemple de Flow Réussi

```
Listing: "Table basse laiton verre Maison Jansen"
  ↓
Pré-estimation: 
  - Prix: 2000€ - 5000€ ✅ (prometteur)
  - Designer: Maison Jansen ✅ (certitude 85%)
  - SearchTerms: ["table basse verre maison jansen", ...]
  ↓
Scraping:
  - AuctionFR: 3 produits trouvés
  - Pamono: 2 produits trouvés
  - 1stdibs: 1 produit trouvé
  ↓
Estimation finale:
  - Prix: 2500€ - 4000€
  - Confiance: 85% ✅
  - Best match: Pamono
  ↓
Sauvegarde: AiAnalysis créé, listing → ANALYZED
```

## Exemple de Flow Arrêté

```
Listing: "Table IKEA blanche"
  ↓
Pré-estimation:
  - Prix: 50€ - 100€ ❌ (pas prometteur)
  ↓
IGNORED (prix trop bas)
```

```
Listing: "Table basse vintage"
  ↓
Pré-estimation:
  - Prix: 1500€ - 3000€ ✅
  - Designer: null ❌ (pas de designer identifié)
  ↓
IGNORED (pas de designer)
```

