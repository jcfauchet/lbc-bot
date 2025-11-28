# LBC Bot - Le Bon Coin Sourcing with AI

Automated scraping bot for Le Bon Coin with AI-powered price estimation and deal scoring.

## Features

- 🔍 Automated Le Bon Coin scraping with Playwright
- 🤖 AI-powered price estimation (OpenAI, Claude, or custom models)
- 📊 Good deal scoring algorithm
- 📧 Email notifications for best opportunities
- 🏗️ Clean architecture (Domain/Application/Infrastructure)
- 🔄 Interchangeable AI providers

## Tech Stack

- **Framework**: Next.js 16 with TypeScript
- **Database**: Supabase PostgreSQL with Prisma ORM
- **Scraping**: Playwright
- **AI**: OpenAI (interchangeable)
- **Email**: Resend
- **Scheduling**: Vercel Cron Jobs

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Setup environment variables

Create a `.env` file based on `.env.example`

### 3. Setup database

```bash
pnpm db:push
```

### 4. Run development server

```bash
pnpm dev
```

### 5. Test manually (optional)

```bash
pnpm scrape:references # Manual scraping of references

pnpm scrape    # Manual scraping
pnpm analyze   # Manual analysis
pnpm notify    # Manual notification
```

The cron jobs will run automatically once deployed on Vercel.

## Project Structure

```
src/
├── domain/           # Business entities and logic
│   ├── entities/
│   ├── repositories/
│   ├── services/
│   └── value-objects/
├── application/      # Use cases
│   └── use-cases/
├── infrastructure/   # External implementations
│   ├── prisma/
│   ├── scraping/
│   ├── ai/
│   ├── mail/
│   └── storage/
├── app/             # Next.js app router
│   ├── api/
│   └── listings/
└── cli/             # CLI scripts
```

## 📚 Documentation complète

- [SETUP.md](./SETUP.md) - Guide d'installation et configuration
- [VERCEL_CRON.md](./VERCEL_CRON.md) - Configuration des cron jobs Vercel

## License

ISC


