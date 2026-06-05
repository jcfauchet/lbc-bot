# LBC Funnel Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-judge valuation flow with a budget-aware funnel (rules → Gemini triage → Google Lens comps) that ends in the existing human triage feed.

**Architecture:** Three sequential use-cases over the existing `LbcProductListing` status machine. Stage A (rules) cuts junk for free; Stage B (Gemini Flash) scores each survivor 0–10 for ranking; Stage C spends a hard-capped Lens budget (8/day, 250/month via SerpAPI) on the top-ranked candidates, valuing them from real comp prices. Valuation never comes from an LLM — only from comps.

**Tech Stack:** Next.js 16 / TypeScript, Prisma + PostgreSQL (Supabase), Vitest, tsx CLIs, `@google/genai` (Gemini), `openai`, SerpAPI (Google Lens via REST `fetch`).

**Spec:** `docs/superpowers/specs/2026-06-05-lbc-funnel-design.md`

---

## File structure (created / modified)

**Domain (interfaces, pure logic — no I/O):**
- Create `src/domain/services/ICompService.ts` — comp search port + `CompMatch`/`CompResult` types.
- Create `src/domain/services/comp-scoring.ts` — pure `scoreComps()` (median/range/confidence).
- Create `src/domain/services/ITriageService.ts` — triage port + `TriageResult`.
- Create `src/domain/repositories/ILensBudgetRepository.ts` — budget counting port.
- Modify `src/domain/value-objects/ListingStatus.ts` — add `PREFILTERED`, `TRIAGED`.
- Modify `src/domain/entities/Listing.ts` — add `triageScore` + transition methods.

**Infrastructure (adapters):**
- Create `src/infrastructure/comps/SerpApiLensCompService.ts` — productized spike.
- Create `src/infrastructure/comps/value-domains.ts` — the value-domain list + helper.
- Create `src/infrastructure/ai/Gemini/GeminiTriageService.ts`.
- Create `src/infrastructure/ai/OpenAi/OpenAiTriageService.ts`.
- Create `src/infrastructure/ai/FallbackTriageService.ts` — Gemini primary, OpenAI on error.
- Create `src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.ts`.
- Modify `src/infrastructure/config/env.ts` — add SerpAPI + budget vars.

**Application (use-cases):**
- Create `src/application/use-cases/RunPreFilterUseCase.ts` — Stage A.
- Create `src/application/use-cases/RunTriageUseCase.ts` — Stage B.
- Create `src/application/use-cases/RunCompAnalysisUseCase.ts` — Stage C (budgeted).

**Glue & retirement:**
- Modify `prisma/schema.prisma` — `triageScore` column + `LensCall` model.
- Modify `src/infrastructure/di/container.ts` — wire new services/use-cases.
- Create `src/cli/prefilter.ts`, `src/cli/triage.ts`; modify `src/cli/analyze.ts`.
- Modify `package.json` — new scripts.
- Delete partner-scraper + designer-gate code (Task 15).

---

## Phase 0 — Foundations

### Task 1: Prisma schema — triage score + Lens budget ledger

**Files:**
- Modify: `prisma/schema.prisma` (model `LbcProductListing` ~line 21; append new model)

- [ ] **Step 1: Add `triageScore` to `LbcProductListing`**

In `model LbcProductListing`, after the `status` line (`status String @default("new")`), add:

```prisma
  triageScore  Int?
```

- [ ] **Step 2: Add the `LensCall` ledger model**

Append at the end of the schema file:

```prisma
model LensCall {
  id        String   @id @default(cuid())
  listingId String?
  success   Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@map("lens_calls")
}
```

- [ ] **Step 3: Create and apply the migration**

Run: `pnpm db:migrate -- --name funnel_triage_and_lens_calls`
Expected: migration created under `prisma/migrations/`, `prisma generate` runs, no error.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add triageScore and LensCall ledger for the funnel"
```

### Task 2: Environment variables

**Files:**
- Modify: `src/infrastructure/config/env.ts:4-31` (the `envSchema`)
- Modify: `.env` (local, not committed)

- [ ] **Step 1: Extend the zod schema**

In `envSchema`, add these keys (next to the other optional vars):

```typescript
  SERPAPI_KEY: z.string().min(1),
  LENS_DAILY_BUDGET: z.coerce.number().min(0).default(8),
  LENS_MONTHLY_BUDGET: z.coerce.number().min(0).default(250),
  TRIAGE_MIN_SCORE: z.coerce.number().min(0).max(10).default(5),
```

- [ ] **Step 2: Ensure `.env` has the keys**

`SERPAPI_KEY` is already present. Append defaults if missing:

```
LENS_DAILY_BUDGET=8
LENS_MONTHLY_BUDGET=250
TRIAGE_MIN_SCORE=5
```

- [ ] **Step 3: Verify env loads**

Run: `pnpm tsx -e "import('./src/infrastructure/config/env').then(m => console.log('ok', m.env.LENS_DAILY_BUDGET))"`
Expected: prints `ok 8`.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/config/env.ts
git commit -m "feat(config): add SerpAPI key and Lens budget env vars"
```

### Task 3: Listing statuses + entity transitions

**Files:**
- Modify: `src/domain/value-objects/ListingStatus.ts`
- Modify: `src/domain/entities/Listing.ts`
- Test: `src/domain/entities/Listing.transitions.test.ts`

- [ ] **Step 1: Add the two new statuses**

In `ListingStatus.ts`, add inside the enum (after `NEW`):

```typescript
  PREFILTERED = 'prefiltered',
  TRIAGED = 'triaged',
```

- [ ] **Step 2: Write the failing test**

Create `src/domain/entities/Listing.transitions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Listing } from './Listing'
import { ListingStatus } from '../value-objects/ListingStatus'
import { Money } from '../value-objects/Money'

function make(): Listing {
  return Listing.create({
    lbcId: 'x', searchId: 's', url: 'u', title: 't',
    price: Money.fromEuros(50), status: ListingStatus.NEW,
  })
}

describe('Listing funnel transitions', () => {
  it('marks as prefiltered', () => {
    const l = make()
    l.markAsPrefiltered()
    expect(l.status).toBe(ListingStatus.PREFILTERED)
  })

  it('marks as triaged and stores the score', () => {
    const l = make()
    l.markAsTriaged(7)
    expect(l.status).toBe(ListingStatus.TRIAGED)
    expect(l.triageScore).toBe(7)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest --run src/domain/entities/Listing.transitions.test.ts`
Expected: FAIL — `markAsPrefiltered is not a function`.

- [ ] **Step 4: Implement transitions + `triageScore`**

In `Listing.ts`: add `triageScore?: number` to `ListingProps`, a getter, and methods:

```typescript
  get triageScore(): number | undefined {
    return this.props.triageScore
  }

  markAsPrefiltered(): void {
    this.props.status = ListingStatus.PREFILTERED
    this.props.updatedAt = new Date()
  }

  markAsTriaged(score: number): void {
    this.props.status = ListingStatus.TRIAGED
    this.props.triageScore = score
    this.props.updatedAt = new Date()
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest --run src/domain/entities/Listing.transitions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/value-objects/ListingStatus.ts src/domain/entities/Listing.ts src/domain/entities/Listing.transitions.test.ts
git commit -m "feat(domain): add prefiltered/triaged statuses and transitions"
```

---

## Phase 1 — Stage C: comp valuation (the core)

### Task 4: Value-domain helper

**Files:**
- Create: `src/infrastructure/comps/value-domains.ts`
- Test: `src/infrastructure/comps/value-domains.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { isValueDomain } from './value-domains'

describe('isValueDomain', () => {
  it('flags auction/design marketplaces', () => {
    expect(isValueDomain('https://www.1stdibs.com/furniture/x')).toBe(true)
    expect(isValueDomain('https://www.selency.fr/p/abc')).toBe(true)
    expect(isValueDomain('https://www.sothebys.com/lot/1')).toBe(true)
  })
  it('rejects generic marketplaces', () => {
    expect(isValueDomain('https://www.amazon.com/x')).toBe(false)
    expect(isValueDomain('https://youtube.com/watch')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/infrastructure/comps/value-domains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export const VALUE_DOMAINS = [
  'selency', '1stdibs', 'pamono', 'design-market', 'drouot', 'interencheres',
  'auction.fr', 'auctionet', 'catawiki', 'sothebys', 'christies', 'artsy',
  'invaluable', 'chairish', 'vinterior', 'proantic', 'expertissim', 'lot-art',
  'incollect', 'lauritz', 'ragoarts', 'michaans',
] as const

export function isValueDomain(urlOrSource: string): boolean {
  const haystack = urlOrSource.toLowerCase()
  return VALUE_DOMAINS.some((d) => haystack.includes(d))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/infrastructure/comps/value-domains.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/comps/value-domains.ts src/infrastructure/comps/value-domains.test.ts
git commit -m "feat(comps): value-domain detection helper"
```

### Task 5: Comp port + pure scoring

**Files:**
- Create: `src/domain/services/ICompService.ts`
- Create: `src/domain/services/comp-scoring.ts`
- Test: `src/domain/services/comp-scoring.test.ts`

- [ ] **Step 1: Define the port + types**

Create `src/domain/services/ICompService.ts`:

```typescript
export interface CompMatch {
  title: string
  source: string
  link: string
  price?: { value: number; currency: string }
  isValueDomain: boolean
}

export interface CompResult {
  matches: CompMatch[]
}

export interface ICompService {
  readonly providerName: string
  /** Reverse-image search on a public image URL. */
  findComps(imageUrl: string): Promise<CompResult>
}
```

- [ ] **Step 2: Write the failing scoring test**

Create `src/domain/services/comp-scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scoreComps } from './comp-scoring'
import type { CompMatch } from './ICompService'

const m = (value: number | undefined, isValueDomain: boolean, currency = 'EUR'): CompMatch => ({
  title: 't', source: 's', link: 'l', isValueDomain,
  price: value === undefined ? undefined : { value, currency },
})

describe('scoreComps', () => {
  it('returns reliable with median/range from priced value comps (>=3)', () => {
    const r = scoreComps([m(1000, true), m(2000, true), m(3000, true), m(99, false)])
    expect(r.confidence).toBe('reliable')
    expect(r.pricedCompCount).toBe(3)
    expect(r.estimatedValueEur).toBe(2000)
    expect(r.rangeMinEur).toBe(1000)
    expect(r.rangeMaxEur).toBe(3000)
  })

  it('ignores priced comps that are not on value domains', () => {
    const r = scoreComps([m(5000, false), m(5000, false)])
    expect(r.pricedCompCount).toBe(0)
    expect(r.confidence).toBe('identified_no_price')
    expect(r.estimatedValueEur).toBeNull()
  })

  it('marks 1-2 priced value comps as to_verify', () => {
    const r = scoreComps([m(1200, true), m(1800, true)])
    expect(r.confidence).toBe('to_verify')
    expect(r.estimatedValueEur).toBe(1500)
  })

  it('converts USD to EUR with the fixed rate', () => {
    const r = scoreComps([m(1000, true, 'USD'), m(1000, true, 'USD'), m(1000, true, 'USD')])
    // 1000 USD * 0.92 = 920
    expect(r.estimatedValueEur).toBe(920)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest --run src/domain/services/comp-scoring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the pure scorer**

Create `src/domain/services/comp-scoring.ts`:

```typescript
import type { CompMatch } from './ICompService'

export type CompConfidence = 'reliable' | 'to_verify' | 'identified_no_price'

export interface CompScore {
  estimatedValueEur: number | null
  rangeMinEur: number | null
  rangeMaxEur: number | null
  pricedCompCount: number
  confidence: CompConfidence
}

// Coarse, configurable-later FX. Kept simple on purpose for the MVP.
const FX_TO_EUR: Record<string, number> = { EUR: 1, USD: 0.92, GBP: 1.17 }

function toEur(value: number, currency: string): number {
  const rate = FX_TO_EUR[currency.toUpperCase()] ?? 1
  return Math.round(value * rate)
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function scoreComps(matches: CompMatch[]): CompScore {
  const prices = matches
    .filter((c) => c.isValueDomain && c.price)
    .map((c) => toEur(c.price!.value, c.price!.currency))
    .sort((a, b) => a - b)

  const count = prices.length
  if (count === 0) {
    return {
      estimatedValueEur: null, rangeMinEur: null, rangeMaxEur: null,
      pricedCompCount: 0, confidence: 'identified_no_price',
    }
  }
  return {
    estimatedValueEur: median(prices),
    rangeMinEur: prices[0],
    rangeMaxEur: prices[count - 1],
    pricedCompCount: count,
    confidence: count >= 3 ? 'reliable' : 'to_verify',
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest --run src/domain/services/comp-scoring.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/ICompService.ts src/domain/services/comp-scoring.ts src/domain/services/comp-scoring.test.ts
git commit -m "feat(comps): comp port and pure median/confidence scoring"
```

### Task 6: SerpAPI Lens comp service

**Files:**
- Create: `src/infrastructure/comps/SerpApiLensCompService.ts`
- Test: `src/infrastructure/comps/SerpApiLensCompService.test.ts`

- [ ] **Step 1: Write the failing test (mock `fetch`)**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SerpApiLensCompService } from './SerpApiLensCompService'

afterEach(() => vi.restoreAllMocks())

describe('SerpApiLensCompService', () => {
  it('maps visual_matches to CompMatch with value-domain + price', async () => {
    const payload = {
      visual_matches: [
        { title: 'Willy Rizzo Alveo', link: 'https://www.1stdibs.com/x', source: '1stDibs',
          price: { value: '$7,855', extracted_value: 7855, currency: '$' } },
        { title: 'Coffee table', link: 'https://youtube.com/y', source: 'YouTube' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

    const svc = new SerpApiLensCompService('FAKE_KEY')
    const { matches } = await svc.findComps('https://img/x.jpg')

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({
      isValueDomain: true,
      price: { value: 7855, currency: 'USD' },
    })
    expect(matches[1].isValueDomain).toBe(false)
    expect(matches[1].price).toBeUndefined()
  })

  it('throws on SerpAPI error payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 200 })))
    const svc = new SerpApiLensCompService('FAKE_KEY')
    await expect(svc.findComps('https://img/x.jpg')).rejects.toThrow(/SerpAPI/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/infrastructure/comps/SerpApiLensCompService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { ICompService, CompResult, CompMatch } from '@/domain/services/ICompService'
import { isValueDomain } from './value-domains'

interface SerpVisualMatch {
  title?: string
  link?: string
  source?: string
  price?: { extracted_value?: number; currency?: string }
}

const CURRENCY_SYMBOL: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP' }

export class SerpApiLensCompService implements ICompService {
  readonly providerName = 'serpapi-google-lens'

  constructor(private readonly apiKey: string) {}

  async findComps(imageUrl: string): Promise<CompResult> {
    const u = new URL('https://serpapi.com/search.json')
    u.searchParams.set('engine', 'google_lens')
    u.searchParams.set('url', imageUrl)
    u.searchParams.set('api_key', this.apiKey)

    const res = await fetch(u)
    const json = (await res.json()) as { error?: string; visual_matches?: SerpVisualMatch[] }
    if (json.error) throw new Error(`SerpAPI: ${json.error}`)

    const matches: CompMatch[] = (json.visual_matches ?? []).map((vm) => {
      const link = vm.link ?? ''
      const source = vm.source ?? ''
      const value = vm.price?.extracted_value
      const rawCurrency = vm.price?.currency ?? ''
      const currency = CURRENCY_SYMBOL[rawCurrency] ?? (rawCurrency || 'EUR')
      return {
        title: vm.title ?? '',
        link,
        source,
        isValueDomain: isValueDomain(`${link} ${source}`),
        price: typeof value === 'number' ? { value, currency } : undefined,
      }
    })

    return { matches }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/infrastructure/comps/SerpApiLensCompService.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/comps/SerpApiLensCompService.ts src/infrastructure/comps/SerpApiLensCompService.test.ts
git commit -m "feat(comps): SerpAPI Google Lens comp service"
```

### Task 7: Lens budget repository

**Files:**
- Create: `src/domain/repositories/ILensBudgetRepository.ts`
- Create: `src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.ts`
- Test: `src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.test.ts`

- [ ] **Step 1: Define the port**

Create `src/domain/repositories/ILensBudgetRepository.ts`:

```typescript
export interface ILensBudgetRepository {
  /** Count Lens calls recorded at or after `since`. */
  countSince(since: Date): Promise<number>
  recordCall(listingId: string | null, success: boolean): Promise<void>
}
```

- [ ] **Step 2: Write the failing test (mock PrismaClient)**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { PrismaLensBudgetRepository } from './PrismaLensBudgetRepository'

describe('PrismaLensBudgetRepository', () => {
  it('countSince delegates to lensCall.count with a createdAt gte filter', async () => {
    const count = vi.fn(async () => 3)
    const prisma = { lensCall: { count } } as any
    const repo = new PrismaLensBudgetRepository(prisma)
    const since = new Date('2026-06-05T00:00:00Z')

    const n = await repo.countSince(since)

    expect(n).toBe(3)
    expect(count).toHaveBeenCalledWith({ where: { createdAt: { gte: since } } })
  })

  it('recordCall creates a row', async () => {
    const create = vi.fn(async () => ({}))
    const prisma = { lensCall: { create } } as any
    const repo = new PrismaLensBudgetRepository(prisma)

    await repo.recordCall('listing-1', true)

    expect(create).toHaveBeenCalledWith({ data: { listingId: 'listing-1', success: true } })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest --run src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```typescript
import type { PrismaClient } from '@prisma/client'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'

export class PrismaLensBudgetRepository implements ILensBudgetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countSince(since: Date): Promise<number> {
    return this.prisma.lensCall.count({ where: { createdAt: { gte: since } } })
  }

  async recordCall(listingId: string | null, success: boolean): Promise<void> {
    await this.prisma.lensCall.create({ data: { listingId, success } })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest --run src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/repositories/ILensBudgetRepository.ts src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.ts src/infrastructure/prisma/repositories/PrismaLensBudgetRepository.test.ts
git commit -m "feat(comps): Lens budget ledger repository"
```

---

## Phase 2 — Stage B: triage

### Task 8: Triage port

**Files:**
- Create: `src/domain/services/ITriageService.ts`

- [ ] **Step 1: Define the port**

```typescript
export interface TriageResult {
  /** 0–10 "worth a Lens call" score. */
  score: number
  rationale?: string
}

export interface ITriageService {
  readonly providerName: string
  triage(imageUrl: string, title: string): Promise<TriageResult>
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domain/services/ITriageService.ts
git commit -m "feat(triage): triage service port"
```

### Task 9: Gemini triage + OpenAI fallback

**Files:**
- Create: `src/infrastructure/ai/Gemini/GeminiTriageService.ts`
- Create: `src/infrastructure/ai/OpenAi/OpenAiTriageService.ts`
- Create: `src/infrastructure/ai/FallbackTriageService.ts`
- Create: `src/infrastructure/ai/triage-prompt.ts`
- Test: `src/infrastructure/ai/FallbackTriageService.test.ts`
- Test: `src/infrastructure/ai/triage-prompt.test.ts`

- [ ] **Step 1: Write the failing test for score parsing**

Create `src/infrastructure/ai/triage-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { TRIAGE_PROMPT, parseTriageScore } from './triage-prompt'

describe('parseTriageScore', () => {
  it('extracts a 0-10 integer from a JSON-ish reply', () => {
    expect(parseTriageScore('{"score": 8, "rationale": "brass lamp"}')).toEqual({ score: 8, rationale: 'brass lamp' })
  })
  it('clamps out-of-range and falls back to 0 on garbage', () => {
    expect(parseTriageScore('score: 99').score).toBe(10)
    expect(parseTriageScore('no number here').score).toBe(0)
  })
})

describe('TRIAGE_PROMPT', () => {
  it('instructs NOT to name a designer', () => {
    expect(TRIAGE_PROMPT.toLowerCase()).toContain('do not')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/infrastructure/ai/triage-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt + parser**

Create `src/infrastructure/ai/triage-prompt.ts`:

```typescript
import type { TriageResult } from '@/domain/services/ITriageService'

export const TRIAGE_PROMPT = [
  'You are triaging a second-hand listing photo for a vintage furniture & decor reseller.',
  'Rate from 0 to 10 how worth-investigating this piece is: does it LOOK like a vintage,',
  'designer, brass/bronze, lacquer, mid-century or Hollywood-Regency decorative piece that',
  'could have hidden resale value? High score = visually special/old/crafted. Low score =',
  'generic, modern, flat-pack, damaged-beyond-value.',
  'Do NOT try to name a designer or maker. Judge only the visual "worth a closer look" signal.',
  'Reply with strict JSON: {"score": <0-10 integer>, "rationale": "<short>"}',
].join(' ')

export function parseTriageScore(raw: string): TriageResult {
  const match = raw.match(/-?\d+(\.\d+)?/)
  if (!match) return { score: 0 }
  const n = Math.round(Number(match[0]))
  const score = Math.max(0, Math.min(10, n))
  const rationaleMatch = raw.match(/"rationale"\s*:\s*"([^"]*)"/)
  return { score, rationale: rationaleMatch?.[1] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/infrastructure/ai/triage-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Gemini triage service**

Create `src/infrastructure/ai/Gemini/GeminiTriageService.ts` (mirrors the existing Gemini service's `@google/genai` usage):

```typescript
import { GoogleGenAI } from '@google/genai'
import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'
import { TRIAGE_PROMPT, parseTriageScore } from '../triage-prompt'

export class GeminiTriageService implements ITriageService {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async triage(imageUrl: string, title: string): Promise<TriageResult> {
    const imageBytes = Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64')
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${TRIAGE_PROMPT}\nListing title: ${title}` },
        { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
      ],
    })
    return parseTriageScore(response.text ?? '')
  }
}
```

> NOTE for implementer: confirm `gemini-2.5-flash` is available to the key (`curl '.../v1beta/models?key=...'`). If the repo's `gemini-3-flash-preview` is available, prefer it; otherwise keep `2.5-flash`.

- [ ] **Step 6: Implement the OpenAI triage service**

Create `src/infrastructure/ai/OpenAi/OpenAiTriageService.ts`:

```typescript
import OpenAI from 'openai'
import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'
import { TRIAGE_PROMPT, parseTriageScore } from '../triage-prompt'

export class OpenAiTriageService implements ITriageService {
  readonly providerName = 'openai'
  private readonly client: OpenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey })
    this.model = model
  }

  async triage(imageUrl: string, title: string): Promise<TriageResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${TRIAGE_PROMPT}\nListing title: ${title}` },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    })
    return parseTriageScore(completion.choices[0]?.message?.content ?? '')
  }
}
```

- [ ] **Step 7: Write the failing fallback test**

Create `src/infrastructure/ai/FallbackTriageService.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { FallbackTriageService } from './FallbackTriageService'
import type { ITriageService } from '@/domain/services/ITriageService'

const stub = (name: string, impl: () => Promise<{ score: number }>): ITriageService => ({
  providerName: name, triage: vi.fn(impl),
})

describe('FallbackTriageService', () => {
  it('uses the primary when it succeeds', async () => {
    const primary = stub('gemini', async () => ({ score: 7 }))
    const fallback = stub('openai', async () => ({ score: 1 }))
    const svc = new FallbackTriageService(primary, fallback)
    expect((await svc.triage('u', 't')).score).toBe(7)
    expect(fallback.triage).not.toHaveBeenCalled()
  })

  it('falls back when the primary throws', async () => {
    const primary = stub('gemini', async () => { throw new Error('rate limit') })
    const fallback = stub('openai', async () => ({ score: 4 }))
    const svc = new FallbackTriageService(primary, fallback)
    expect((await svc.triage('u', 't')).score).toBe(4)
    expect(fallback.triage).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest --run src/infrastructure/ai/FallbackTriageService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement the fallback wrapper**

Create `src/infrastructure/ai/FallbackTriageService.ts`:

```typescript
import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'

export class FallbackTriageService implements ITriageService {
  readonly providerName: string

  constructor(
    private readonly primary: ITriageService,
    private readonly fallback: ITriageService,
  ) {
    this.providerName = `${primary.providerName}+${fallback.providerName}`
  }

  async triage(imageUrl: string, title: string): Promise<TriageResult> {
    try {
      return await this.primary.triage(imageUrl, title)
    } catch (err) {
      console.warn(`Triage primary (${this.primary.providerName}) failed, falling back:`, err)
      return this.fallback.triage(imageUrl, title)
    }
  }
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm vitest --run src/infrastructure/ai/FallbackTriageService.test.ts src/infrastructure/ai/triage-prompt.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/infrastructure/ai/triage-prompt.ts src/infrastructure/ai/triage-prompt.test.ts src/infrastructure/ai/Gemini/GeminiTriageService.ts src/infrastructure/ai/OpenAi/OpenAiTriageService.ts src/infrastructure/ai/FallbackTriageService.ts src/infrastructure/ai/FallbackTriageService.test.ts
git commit -m "feat(triage): Gemini triage with OpenAI fallback"
```

---

## Phase 3 — Pipeline use-cases

### Task 10: Stage A — RunPreFilterUseCase

**Files:**
- Create: `src/application/use-cases/RunPreFilterUseCase.ts`
- Test: `src/application/use-cases/RunPreFilterUseCase.test.ts`

Stage A reads `new` listings, applies `ITextFilterService.shouldExclude` and the
configured price bounds (`MIN_LISTING_PRICE_EUR`/`MAX_LISTING_PRICE_EUR`), and moves each
to `prefiltered` or `ignored`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { RunPreFilterUseCase } from './RunPreFilterUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mkListing = (title: string, euros: number) =>
  Listing.create({ lbcId: 'a', searchId: 's', url: 'u', title, price: Money.fromEuros(euros), status: ListingStatus.NEW })

describe('RunPreFilterUseCase', () => {
  it('prefilters a good cheap listing and ignores an excluded one', async () => {
    const good = mkListing('lampadaire laiton vintage', 80)
    const bad = mkListing('table IKEA', 80)
    const updated: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [good, bad]),
      update: vi.fn(async (l: Listing) => { updated[l.title] = l.status; return l }),
    } as any
    const textFilterService = {
      shouldExclude: (t: string) => t.includes('IKEA') ? { exclude: true, reason: 'ikea' } : { exclude: false },
    } as any

    const useCase = new RunPreFilterUseCase(listingRepository, textFilterService, { minEuros: 50, maxEuros: 700 })
    const res = await useCase.execute()

    expect(updated['lampadaire laiton vintage']).toBe(ListingStatus.PREFILTERED)
    expect(updated['table IKEA']).toBe(ListingStatus.IGNORED)
    expect(res).toEqual({ prefiltered: 1, ignored: 1 })
  })

  it('ignores listings priced above the max', async () => {
    const pricey = mkListing('console laiton', 2000)
    const updated: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [pricey]),
      update: vi.fn(async (l: Listing) => { updated[l.title] = l.status; return l }),
    } as any
    const textFilterService = { shouldExclude: () => ({ exclude: false }) } as any

    const useCase = new RunPreFilterUseCase(listingRepository, textFilterService, { minEuros: 50, maxEuros: 700 })
    await useCase.execute()
    expect(updated['console laiton']).toBe(ListingStatus.IGNORED)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/application/use-cases/RunPreFilterUseCase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { ITextFilterService } from '@/domain/services/ITextFilterService'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface PriceBounds { minEuros: number; maxEuros: number }

export class RunPreFilterUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private textFilterService: ITextFilterService,
    private bounds: PriceBounds,
  ) {}

  async execute(): Promise<{ prefiltered: number; ignored: number }> {
    const listings = await this.listingRepository.findByStatus(ListingStatus.NEW)
    let prefiltered = 0
    let ignored = 0

    for (const listing of listings) {
      const euros = listing.price.getEuros()
      const filter = this.textFilterService.shouldExclude(listing.title)

      if (filter.exclude) {
        listing.markAsIgnored()
        listing.setIgnoreReason(filter.reason ?? 'text filter')
        await this.listingRepository.update(listing)
        ignored++
      } else if (euros < this.bounds.minEuros || euros > this.bounds.maxEuros) {
        listing.markAsIgnored()
        listing.setIgnoreReason(`price ${euros}€ out of [${this.bounds.minEuros}, ${this.bounds.maxEuros}]`)
        await this.listingRepository.update(listing)
        ignored++
      } else {
        listing.markAsPrefiltered()
        await this.listingRepository.update(listing)
        prefiltered++
      }
    }

    return { prefiltered, ignored }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/application/use-cases/RunPreFilterUseCase.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/RunPreFilterUseCase.ts src/application/use-cases/RunPreFilterUseCase.test.ts
git commit -m "feat(funnel): stage A pre-filter use-case"
```

### Task 11: Stage B — RunTriageUseCase

**Files:**
- Create: `src/application/use-cases/RunTriageUseCase.ts`
- Test: `src/application/use-cases/RunTriageUseCase.test.ts`

Reads `prefiltered`, calls `ITriageService` with the first image URL, stores the score.
`score >= TRIAGE_MIN_SCORE` → `triaged`; else → `ignored`. Listings with no image → `ignored`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { RunTriageUseCase } from './RunTriageUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mk = (id: string) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: 't', price: Money.fromEuros(80), status: ListingStatus.PREFILTERED })
  ;(l as any).props = { ...(l as any).props, id }
  return l
}

describe('RunTriageUseCase', () => {
  it('triages above threshold and ignores below', async () => {
    const high = mk('h'); const low = mk('l')
    const out: Record<string, { status: ListingStatus; score?: number }> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [high, low]),
      update: vi.fn(async (l: Listing) => { out[l.id] = { status: l.status, score: l.triageScore }; return l }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any
    const triageService = {
      providerName: 'gemini',
      triage: vi.fn(async (_u: string) => ({ score: out['h'] ? 2 : 8 })),
    } as any
    // first call (high) → 8, second (low) → 2: drive by call order
    triageService.triage
      .mockResolvedValueOnce({ score: 8 })
      .mockResolvedValueOnce({ score: 2 })

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5)
    const res = await useCase.execute()

    expect(out['h'].status).toBe(ListingStatus.TRIAGED)
    expect(out['h'].score).toBe(8)
    expect(out['l'].status).toBe(ListingStatus.IGNORED)
    expect(res).toEqual({ triaged: 1, ignored: 1 })
  })

  it('ignores listings with no image', async () => {
    const l = mk('n')
    const out: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [l]),
      update: vi.fn(async (x: Listing) => { out[x.id] = x.status; return x }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => []) } as any
    const triageService = { providerName: 'gemini', triage: vi.fn() } as any

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5)
    await useCase.execute()

    expect(out['n']).toBe(ListingStatus.IGNORED)
    expect(triageService.triage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/application/use-cases/RunTriageUseCase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ITriageService } from '@/domain/services/ITriageService'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export class RunTriageUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private imageRepository: IListingImageRepository,
    private triageService: ITriageService,
    private minScore: number,
  ) {}

  async execute(): Promise<{ triaged: number; ignored: number }> {
    const listings = await this.listingRepository.findByStatus(ListingStatus.PREFILTERED)
    let triaged = 0
    let ignored = 0

    for (const listing of listings) {
      const images = await this.imageRepository.findByListingId(listing.id)
      const imageUrl = images[0]?.urlRemote
      if (!imageUrl) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no image for triage')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const { score } = await this.triageService.triage(imageUrl, listing.title)
      if (score >= this.minScore) {
        listing.markAsTriaged(score)
        triaged++
      } else {
        listing.markAsTriaged(score)
        listing.markAsIgnored()
        listing.setIgnoreReason(`triage score ${score} < ${this.minScore}`)
        ignored++
      }
      await this.listingRepository.update(listing)
    }

    return { triaged, ignored }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/application/use-cases/RunTriageUseCase.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/RunTriageUseCase.ts src/application/use-cases/RunTriageUseCase.test.ts
git commit -m "feat(funnel): stage B triage use-case"
```

### Task 12: Stage C — RunCompAnalysisUseCase (budgeted)

**Files:**
- Create: `src/application/use-cases/RunCompAnalysisUseCase.ts`
- Test: `src/application/use-cases/RunCompAnalysisUseCase.test.ts`

Picks `triaged` listings ordered by `triageScore` desc, computes the remaining Lens
budget (`min(dailyRemaining, monthlyRemaining)`), and for each (within budget):
records a Lens call, calls `ICompService.findComps`, scores with `scoreComps`, then
saves an `AiAnalysis` and marks `analyzed` — or `ignored` if no value comps at all.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { RunCompAnalysisUseCase } from './RunCompAnalysisUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mk = (id: string, score: number, euros = 80) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: id, price: Money.fromEuros(euros), status: ListingStatus.TRIAGED })
  ;(l as any).props = { ...(l as any).props, id, triageScore: score }
  return l
}

const deps = (overrides: any = {}) => {
  const saved: any[] = []
  const statuses: Record<string, ListingStatus> = {}
  return {
    saved, statuses,
    listingRepository: {
      findByStatus: vi.fn(async () => overrides.listings ?? []),
      update: vi.fn(async (l: Listing) => { statuses[l.id] = l.status; return l }),
    } as any,
    aiAnalysisRepository: { save: vi.fn(async (a: any) => { saved.push(a); return a }) } as any,
    imageRepository: { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any,
    compService: { providerName: 'serpapi', findComps: vi.fn(async () => overrides.comps ?? { matches: [] }) } as any,
    budgetRepository: {
      countSince: vi.fn(async () => 0),
      recordCall: vi.fn(async () => {}),
    } as any,
  }
}

describe('RunCompAnalysisUseCase', () => {
  it('analyzes the highest-scored listing and saves an AiAnalysis', async () => {
    const d = deps({
      listings: [mk('low', 6), mk('high', 9)],
      comps: { matches: [
        { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
        { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
        { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
      ] },
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250 },
    )
    const res = await useCase.execute()

    // highest score processed first
    expect(d.compService.findComps).toHaveBeenCalledTimes(2)
    expect(d.saved).toHaveLength(2)
    expect(d.statuses['high']).toBe(ListingStatus.ANALYZED)
    expect(d.saved[0].estimatedMinPrice.getEuros()).toBe(1000)
    expect(d.saved[0].estimatedMaxPrice.getEuros()).toBe(3000)
    expect(res.analyzed).toBe(2)
  })

  it('stops at the remaining daily budget', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 8), mk('c', 7)] })
    d.budgetRepository.countSince = vi.fn(async (since: Date) => {
      // daily window returns 7 (1 left), monthly returns 7 too
      return 7
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250 },
    )
    const res = await useCase.execute()
    expect(d.compService.findComps).toHaveBeenCalledTimes(1)
    expect(res.processed).toBe(1)
  })

  it('ignores a listing with no value comps', async () => {
    const d = deps({ listings: [mk('a', 9)], comps: { matches: [
      { title: 'x', source: 'youtube', link: 'https://youtube.com/x', isValueDomain: false },
    ] } })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250 },
    )
    await useCase.execute()
    expect(d.statuses['a']).toBe(ListingStatus.IGNORED)
    expect(d.saved).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ICompService } from '@/domain/services/ICompService'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'
import { scoreComps } from '@/domain/services/comp-scoring'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface LensBudgetConfig { dailyBudget: number; monthlyBudget: number }

function startOfDay(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
function startOfMonth(): Date { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) }

export class RunCompAnalysisUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private imageRepository: IListingImageRepository,
    private compService: ICompService,
    private budgetRepository: ILensBudgetRepository,
    private config: LensBudgetConfig,
  ) {}

  async execute(): Promise<{ processed: number; analyzed: number; ignored: number }> {
    const usedToday = await this.budgetRepository.countSince(startOfDay())
    const usedThisMonth = await this.budgetRepository.countSince(startOfMonth())
    let remaining = Math.min(this.config.dailyBudget - usedToday, this.config.monthlyBudget - usedThisMonth)
    if (remaining <= 0) return { processed: 0, analyzed: 0, ignored: 0 }

    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) => (b.triageScore ?? 0) - (a.triageScore ?? 0))

    let processed = 0
    let analyzed = 0
    let ignored = 0

    for (const listing of candidates) {
      if (remaining <= 0) break

      const images = await this.imageRepository.findByListingId(listing.id)
      const imageUrl = images[0]?.urlRemote
      if (!imageUrl) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no image for comp search')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      remaining--
      processed++
      let comps
      try {
        comps = await this.compService.findComps(imageUrl)
        await this.budgetRepository.recordCall(listing.id, true)
      } catch (err) {
        await this.budgetRepository.recordCall(listing.id, false)
        console.error(`Comp search failed for ${listing.id}:`, err)
        continue
      }

      const score = scoreComps(comps.matches)
      if (score.estimatedValueEur === null) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no priced value comps')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const estMin = Money.fromEuros(score.rangeMinEur!)
      const estMax = Money.fromEuros(score.rangeMaxEur!)
      const median = Money.fromEuros(score.estimatedValueEur)
      const topComp = comps.matches.find((m) => m.isValueDomain && m.price)?.link

      const analysis = AiAnalysis.create({
        listingId: listing.id,
        estimatedMinPrice: estMin,
        estimatedMaxPrice: estMax,
        margin: median.minus(listing.price),
        description: `Median value ${score.estimatedValueEur}€ from ${score.pricedCompCount} value comps (${score.confidence}). Range ${score.rangeMinEur}–${score.rangeMaxEur}€.`,
        confidence: score.confidence === 'reliable' ? 0.9 : 0.6,
        provider: this.compService.providerName,
        bestMatchSource: topComp,
        searchTerms: [],
      })
      await this.aiAnalysisRepository.save(analysis)
      listing.markAsAnalyzed()
      await this.listingRepository.update(listing)
      analyzed++
    }

    return { processed, analyzed, ignored }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/RunCompAnalysisUseCase.ts src/application/use-cases/RunCompAnalysisUseCase.test.ts
git commit -m "feat(funnel): stage C budgeted comp analysis use-case"
```

---

## Phase 4 — Wiring & CLIs

### Task 13: DI container wiring

**Files:**
- Modify: `src/infrastructure/di/container.ts`

- [ ] **Step 1: Add imports**

Near the other infra imports add:

```typescript
import { SerpApiLensCompService } from '@/infrastructure/comps/SerpApiLensCompService'
import { GeminiTriageService } from '@/infrastructure/ai/Gemini/GeminiTriageService'
import { OpenAiTriageService } from '@/infrastructure/ai/OpenAi/OpenAiTriageService'
import { FallbackTriageService } from '@/infrastructure/ai/FallbackTriageService'
import { PrismaLensBudgetRepository } from '@/infrastructure/prisma/repositories/PrismaLensBudgetRepository'
import { RunPreFilterUseCase } from '@/application/use-cases/RunPreFilterUseCase'
import { RunTriageUseCase } from '@/application/use-cases/RunTriageUseCase'
import { RunCompAnalysisUseCase } from '@/application/use-cases/RunCompAnalysisUseCase'
```

- [ ] **Step 2: Declare the new public fields**

Add to the `Container` class field declarations:

```typescript
  public readonly compService: SerpApiLensCompService
  public readonly triageService: FallbackTriageService
  public readonly lensBudgetRepository: PrismaLensBudgetRepository
  public readonly runPreFilterUseCase: RunPreFilterUseCase
  public readonly runTriageUseCase: RunTriageUseCase
  public readonly runCompAnalysisUseCase: RunCompAnalysisUseCase
```

- [ ] **Step 3: Construct them in the constructor**

After `this.textFilterService = new TextFilterService()` add:

```typescript
    this.compService = new SerpApiLensCompService(env.SERPAPI_KEY)
    this.triageService = new FallbackTriageService(
      new GeminiTriageService(env.GOOGLE_GEMINI_API_KEY),
      new OpenAiTriageService(env.OPENAI_API_KEY),
    )
    this.lensBudgetRepository = new PrismaLensBudgetRepository(this.prisma)

    this.runPreFilterUseCase = new RunPreFilterUseCase(
      this.listingRepository,
      this.textFilterService,
      { minEuros: env.MIN_LISTING_PRICE_EUR, maxEuros: env.MAX_LISTING_PRICE_EUR },
    )
    this.runTriageUseCase = new RunTriageUseCase(
      this.listingRepository,
      this.listingImageRepository,
      this.triageService,
      env.TRIAGE_MIN_SCORE,
    )
    this.runCompAnalysisUseCase = new RunCompAnalysisUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.listingImageRepository,
      this.compService,
      this.lensBudgetRepository,
      { dailyBudget: env.LENS_DAILY_BUDGET, monthlyBudget: env.LENS_MONTHLY_BUDGET },
    )
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm tsx -e "import('./src/infrastructure/di/container').then(() => console.log('container ok'))"`
Expected: prints `container ok` (DB/env must be set).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/di/container.ts
git commit -m "feat(di): wire funnel services and use-cases"
```

### Task 14: CLIs + package.json scripts

**Files:**
- Create: `src/cli/prefilter.ts`
- Create: `src/cli/triage.ts`
- Modify: `src/cli/analyze.ts`
- Modify: `package.json:scripts`

- [ ] **Step 1: Create `src/cli/prefilter.ts`**

```typescript
#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🧹 Stage A — pre-filter...')
  const res = await container.runPreFilterUseCase.execute()
  console.log(`   prefiltered: ${res.prefiltered} | ignored: ${res.ignored}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Create `src/cli/triage.ts`**

```typescript
#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🔎 Stage B — Gemini triage...')
  const res = await container.runTriageUseCase.execute()
  console.log(`   triaged: ${res.triaged} | ignored: ${res.ignored}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Replace the body of `src/cli/analyze.ts`**

```typescript
#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('💎 Stage C — Lens comp analysis (budgeted)...')
  try {
    const res = await container.runCompAnalysisUseCase.execute()
    console.log(`   processed: ${res.processed} | analyzed: ${res.analyzed} | ignored: ${res.ignored}`)
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    await container.cleanup()
  }
}

main()
```

- [ ] **Step 4: Add scripts to `package.json`**

In `"scripts"`, add:

```json
    "prefilter": "tsx src/cli/prefilter.ts",
    "triage": "tsx src/cli/triage.ts",
    "funnel": "pnpm scrape && pnpm prefilter && pnpm triage && pnpm analyze",
```

- [ ] **Step 5: Smoke-test the chain on a tiny scale**

Run: `pnpm prefilter && pnpm triage`
Expected: both print counts without throwing (0s are fine if the DB is empty).

- [ ] **Step 6: Commit**

```bash
git add src/cli/prefilter.ts src/cli/triage.ts src/cli/analyze.ts package.json
git commit -m "feat(cli): prefilter/triage/analyze stage runners + funnel script"
```

---

## Phase 5 — Retire dead code

### Task 15: Remove partner scrapers, designer gate, and the old estimation flow

**Files:**
- Delete the partner-scraper infra (Auction.fr / Pamono / 1stDibs reference scrapers) and the
  designer-detection pre-estimation path that fed `RunAiAnalysisUseCase`.
- Modify: `src/infrastructure/di/container.ts` (drop `priceEstimationService` + the old
  `RunAiAnalysisUseCase` wiring once nothing references them).
- Delete: `ESTIMATION_FLOW.md` (superseded by the new spec).

- [ ] **Step 1: Find references to retire**

Run:
```bash
grep -rln "PriceEstimationService\|preEstimate\|searchTerms\|AuctionFr\|Pamono\|1stdibs\|run-scrapers" src/ | sort -u
```
Expected: a list of files using the old estimation/reference-scraping path.

- [ ] **Step 2: Delete the old `RunAiAnalysisUseCase` and its CLI references**

The new `analyze.ts` already points at `runCompAnalysisUseCase`. Delete:
```bash
git rm src/application/use-cases/RunAiAnalysisUseCase.ts src/application/use-cases/RunAiAnalysisUseCase.test.ts
```
Then remove its construction + the `runAiAnalysisUseCase`/`priceEstimationService` fields from `container.ts`, and the `scrape:references` script + `src/cli/run-scrapers.ts` if present.

- [ ] **Step 3: Delete partner reference scrapers**

For each partner-scraper file found in Step 1 (e.g. under `src/infrastructure/scraping/references/` or similar), `git rm` it, plus the now-orphaned `IPriceEstimationService` implementations (`OpenAiPriceEstimationService`, `GeminiPriceEstimationService`, `BasePriceEstimationService`) — keep `EmbeddingService` (deferred RAG).

- [ ] **Step 4: Verify the project builds and tests pass**

Run: `pnpm vitest --run`
Expected: PASS (no references to deleted modules).
Run: `pnpm build`
Expected: build succeeds (no TS errors).

- [ ] **Step 5: Delete the superseded doc**

```bash
git rm ESTIMATION_FLOW.md
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: retire designer-gate estimation flow and partner scrapers (replaced by Lens funnel)"
```

---

## End-to-end verification (after all tasks)

- [ ] Run the full suite: `pnpm vitest --run` → all green.
- [ ] Seed a handful of real `new` listings (existing `pnpm scrape` against active searches).
- [ ] `pnpm prefilter` → some become `prefiltered`.
- [ ] `pnpm triage` → some become `triaged` with scores.
- [ ] `pnpm analyze` → ≤8 Lens calls spent (check `lens_calls` table count), `AiAnalysis` rows created with median/range.
- [ ] Open the existing frontend → analyzed listings appear with estimate + margin; 👍/👎 still works.
- [ ] Re-run `pnpm analyze` immediately → reports `processed: 0` (daily budget already spent), proving the guard.

## Self-review notes (author)
- Spec coverage: §5 funnel (Tasks 10–12), §6 reuse/rebuild (Tasks 12, 15), §7 stages A/B/C (Tasks 10, 11/9, 6/12), §8 scoring (Task 5), §9 budget guard (Tasks 1, 7, 12), §10 feed reuses existing frontend (no task — unchanged), §11 cost = free tier enforced by Task 12, §13 already provisioned. ✓
- Deferred per spec non-goals: OpenAI-embeddings RAG (kept dormant — `EmbeddingService` retained), object-detection crop for bad photos, self-hosted embedding comp DB.
- FX conversion is intentionally coarse (Task 5) — flagged as configurable-later, acceptable for MVP.
