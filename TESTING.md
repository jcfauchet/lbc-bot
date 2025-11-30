# Tests Unitaires

Tests unitaires pour tester facilement les composants en local et voir les résultats de manière lisible.

## Exécuter les tests

```bash
# Tous les tests
pnpm test

# Un test spécifique
pnpm test AuctionFrScraper
pnpm test PamonoScraper
pnpm test OpenAiPriceEstimationService
```

## Tests disponibles

### Scrapers de Référence

- **AuctionFrScraper.test.ts** : Teste le scraper AuctionFR
  ```bash
  pnpm test AuctionFrScraper
  ```
  Affiche les produits trouvés avec titre, prix, URL, designer, etc.

- **PamonoScraper.test.ts** : Teste le scraper Pamono
  ```bash
  pnpm test PamonoScraper
  ```

- **FirstDibsScraper.test.ts** : Teste le scraper 1stdibs
  ```bash
  pnpm test FirstDibsScraper
  ```

### Services d'Estimation IA

- **OpenAiPriceEstimationService.test.ts** : Teste la pré-estimation et l'estimation finale avec OpenAI
  ```bash
  pnpm test OpenAiPriceEstimationService
  ```
  Affiche :
  - Prix estimé (min/max)
  - Si c'est prometteur
  - Si un designer est identifié
  - Les termes de recherche générés (max 4)
  - La description de l'analyse
  - Source du meilleur match (partenaire)

- **GeminiPriceEstimationService.test.ts** : Teste la pré-estimation et l'estimation finale avec Gemini
  ```bash
  pnpm test GeminiPriceEstimationService
  ```

### Use Cases

- **RunAiAnalysisUseCase.test.ts** : Teste le flow complet d'analyse
  ```bash
  pnpm test RunAiAnalysisUseCase
  ```
  Affiche le nombre de listings analysés et les erreurs éventuelles.

## Notes

- Les tests utilisent les variables d'environnement du `.env`
- Pour tester avec de vraies images, modifiez les URLs dans les fichiers `.test.ts`
- Les scrapers nécessitent des credentials (AuctionFR notamment)
- Les tests IA nécessitent une clé API OpenAI ou Gemini
- Les résultats sont affichés de manière lisible dans la console avec le JSON complet à la fin

