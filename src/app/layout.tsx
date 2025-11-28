import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'LBC Bot - Le Bon Coin Sourcing',
  description: 'AI-powered Le Bon Coin deal finder',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body>
        <header>
          <nav className="flex gap-4 justify-center items-center p-4 bg-gray-100">
            <Link href="/" className="text-blue-600 no-underline hover:underline">Home</Link>
            <Link href="/searches" className="text-blue-600 no-underline hover:underline">Searches</Link>
            <Link href="/taxonomy" className="text-blue-600 no-underline hover:underline">Taxonomy</Link>
          </nav>
        </header>

        {children}

      </body>
    </html>
  )
}


