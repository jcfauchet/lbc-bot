export default function Home() {
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl mb-4">
          🤖 LBC Bot
        </h1>
        <p className="text-xl text-gray-600">
          Bot de sourcing Le Bon Coin avec IA
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="mb-4">🔍 Scraping</h2>
          <p className="text-gray-600 mb-4">
            Scrape les annonces Le Bon Coin automatiquement
          </p>
          <div className="mb-4 space-y-2">
            <div>
              <a href="/searches" className="text-blue-600 no-underline font-bold hover:underline">
                Manage Searches &rarr;
              </a>
            </div>
            <div>
              <a href="/taxonomy" className="text-blue-600 no-underline font-bold hover:underline">
                Manage Taxonomy &rarr;
              </a>
            </div>
          </div>
          <code className="bg-gray-200 p-2 rounded block">
            pnpm scrape
          </code>
        </div>

        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="mb-4">🤖 Analyse IA</h2>
          <p className="text-gray-600 mb-4">
            Estime les prix et calcule les scores de bonnes affaires
          </p>
          <code className="bg-gray-200 p-2 rounded block">
            pnpm analyze
          </code>
        </div>

        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="mb-4">📧 Notifications</h2>
          <p className="text-gray-600 mb-4">
            Envoie des emails avec les meilleures opportunités
          </p>
          <code className="bg-gray-200 p-2 rounded block">
            pnpm notify
          </code>
        </div>
      </div>

      <div className="bg-cyan-50 p-6 rounded-lg mb-8">
        <h3 className="mb-2">⏰ Vercel Cron Jobs</h3>
        <p className="text-cyan-900 mb-4">
          Les tâches s&apos;exécutent automatiquement sur Vercel :
        </p>
        <ul className="list-none p-0 text-cyan-900">
          <li>🔍 Scraping : toutes les 2 heures</li>
          <li>🤖 Analyse : toutes les heures à :15</li>
          <li>📧 Notification : tous les jours à 9h00</li>
        </ul>
      </div>

      <div className="bg-gray-50 p-6 rounded-lg">
        <h3 className="mb-4">📚 Documentation</h3>
        <ul className="list-none p-0">
          <li className="mb-2">
            📖 Voir le <code className="bg-gray-200 px-1 rounded">README.md</code> pour plus d&apos;informations
          </li>
          <li className="mb-2">
            🔧 Configurer le fichier <code className="bg-gray-200 px-1 rounded">.env</code> avant de commencer
          </li>
          <li>
            🗄️ Lancer <code className="bg-gray-200 px-1 rounded">pnpm db:push</code> pour initialiser la base de données
          </li>
        </ul>
      </div>
    </main>
  )
}


