# Comparative Ranking of Comp Candidates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide which of ~700 weekly triage-qualified listings receive the ~8 daily
comp credits by ranking them against each other, instead of serving whoever happened
to be in the queue at midnight.

**Architecture:** A new `ISelectionRanker` port submits a shortlist of candidates
(photo + title + price) to a vision LLM in one call and gets back an ordered list of
picks. `RunCompAnalysisUseCase` switches from a greedy daily budget to a per-window
entitlement (4 windows of 6h), builds a shortlist from the free filters it already
applies, asks the ranker to order it, and spends credits on the picks in rank order.
The ranker is an optional dependency: unwired or failing, the use case falls back to
its current deterministic order.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/Postgres, Vitest,
`@google/genai` (Gemini 2.5 Flash), clean-architecture layering
(`domain` / `application` / `infrastructure`).

## Global Constraints

- All code in English without exception — identifiers, comments, docstrings. French
  is allowed only in user-facing strings already present in the codebase (e.g.
  `setIgnoreReason` messages, which stay French to match existing rows).
- Commit messages in English, plain, no `Co-Authored-By` lines.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- Tests run with `pnpm test` (`vitest --run`). A single file: `pnpm test <path>`.
- Ports live in `src/domain/`, adapters in `src/infrastructure/`, use cases in
  `src/application/use-cases/`. Use cases depend on port interfaces only.
- Optional constructor dependencies are appended last, so existing call sites and
  tests keep compiling (the pattern already used for `feedbackRepository`,
  `embedder`, `availabilityService`).
- Work happens on the existing branch `feat/comp-candidate-ranking`.

---

## File Structure

**Created:**
- `src/domain/services/ISelectionRanker.ts` — the port: candidate/pick types and the
  `rank()` contract. No logic.
- `src/infrastructure/ai/ranking-prompt.ts` — pure prompt building and response
  parsing. No network, no SDK import. All ranking logic that can be tested offline
  lives here.
- `src/infrastructure/ai/ranking-prompt.test.ts` — unit tests for the above.
- `src/infrastructure/ai/Gemini/GeminiSelectionRanker.ts` — the adapter: fetches
  images, makes the single multi-image call, delegates to the pure module.

**Modified:**
- `src/application/use-cases/RunCompAnalysisUseCase.ts` — windowed entitlement
  replaces the daily + fast-track computation (Task 3); shortlist and ranking
  replace the greedy spend loop (Task 4).
- `src/application/use-cases/RunCompAnalysisUseCase.test.ts` — fast-track tests
  removed, window and ranking tests added.
- `src/infrastructure/config/env.ts` — budget and ranking variables.
- `src/infrastructure/di/container.ts` — wiring.

**Why this split:** the prompt module holds everything testable without a network,
mirroring the existing `triage-prompt.ts` / `GeminiTriageService.ts` division. The
adapter stays thin enough to need no unit test, exactly like `GeminiTriageService`.

---

## Task 1: Ranking port and prompt module

**Files:**
- Create: `src/domain/services/ISelectionRanker.ts`
- Create: `src/infrastructure/ai/ranking-prompt.ts`
- Test: `src/infrastructure/ai/ranking-prompt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `RankingCandidate { listingId: string; imageUrl: string; title: string; priceEur: number; description?: string }`
  - `RankedPick { listingId: string; rank: number; worthCredit: boolean; reason?: string }`
  - `ISelectionRanker { readonly providerName: string; rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]> }`
  - `buildRankingPrompt(guidance?: string | null): string`
  - `renderCandidateList(candidates: RankingCandidate[]): string`
  - `parseRanking(raw: string, candidates: RankingCandidate[]): RankedPick[] | null`

**Key design point:** candidates are labelled `1..N` in the prompt and the model
answers with those numbers, never with database ids. Ids are cuids — a model asked to
echo them will eventually mangle one, and a mangled id is indistinguishable from a
hallucinated pick. Index mapping makes every out-of-range answer trivially
detectable.

**Second key design point:** `parseRanking` returns `null` when the response cannot
be parsed at all, and `[]` when the model validly returned no pick. These are
different outcomes — a parse failure must fall back to deterministic spending, an
empty pick list is a deliberate abstention that spends nothing. Collapsing both into
`[]` would silently convert every broken call into an abstention and starve the
funnel.

- [ ] **Step 1: Create the port**

Create `src/domain/services/ISelectionRanker.ts`:

```ts
export interface RankingCandidate {
  listingId: string
  imageUrl: string
  title: string
  priceEur: number
  description?: string
}

export interface RankedPick {
  listingId: string
  /** 1-based position in the ranker's ordering; 1 is the best bet. */
  rank: number
  /** The ranker judged this piece worth spending a scarce comp credit on. */
  worthCredit: boolean
  reason?: string
}

/**
 * Orders a shortlist of triage-qualified listings against each other so the few
 * daily comp credits go to the safest bets. Comparative judgement is used because
 * absolute 0-10 triage scoring saturates: 967 of 1651 qualified listings scored
 * exactly 9 over the two weeks to 2 Aug 2026, leaving the choice to freshness alone.
 */
export interface ISelectionRanker {
  readonly providerName: string
  rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]>
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/infrastructure/ai/ranking-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildRankingPrompt, parseRanking, renderCandidateList, RANKING_PROMPT } from './ranking-prompt'
import type { RankingCandidate } from '@/domain/services/ISelectionRanker'

const candidates: RankingCandidate[] = [
  { listingId: 'a', imageUrl: 'https://img/a.jpg', title: 'Lampe laiton', priceEur: 80 },
  { listingId: 'b', imageUrl: 'https://img/b.jpg', title: 'Table travertin', priceEur: 250 },
  { listingId: 'c', imageUrl: 'https://img/c.jpg', title: 'Chaise teck', priceEur: 120 },
]

describe('parseRanking', () => {
  it('maps candidate numbers to listing ids, best first', () => {
    const raw = '{"picks":[{"candidate":2,"worthCredit":true,"reason":"travertin"},{"candidate":1,"worthCredit":false}]}'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'b', rank: 1, worthCredit: true, reason: 'travertin' },
      { listingId: 'a', rank: 2, worthCredit: false, reason: undefined },
    ])
  })

  it('returns null when the response cannot be parsed, so the caller can fall back', () => {
    expect(parseRanking('sorry, I cannot help with that', candidates)).toBeNull()
    expect(parseRanking('{"picks":[{"candidate":1,', candidates)).toBeNull()
  })

  it('distinguishes a deliberate abstention from a parse failure', () => {
    expect(parseRanking('{"picks":[]}', candidates)).toEqual([])
  })

  it('reads through markdown code fences', () => {
    const raw = '```json\n{"picks":[{"candidate":3,"worthCredit":true}]}\n```'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'c', rank: 1, worthCredit: true, reason: undefined },
    ])
  })

  it('drops out-of-range, non-integer and duplicated candidate numbers', () => {
    const raw = '{"picks":[{"candidate":9},{"candidate":0},{"candidate":1.5},{"candidate":1},{"candidate":1}]}'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'a', rank: 1, worthCredit: true, reason: undefined },
    ])
  })

  it('treats a missing worthCredit as worth a credit', () => {
    expect(parseRanking('{"picks":[{"candidate":1}]}', candidates)?.[0].worthCredit).toBe(true)
  })
})

describe('renderCandidateList', () => {
  it('numbers candidates from 1 and includes the asking price', () => {
    const rendered = renderCandidateList(candidates)
    expect(rendered).toContain('Candidate 1: Lampe laiton')
    expect(rendered).toContain('Asking price: 80€')
    expect(rendered).toContain('Candidate 3: Chaise teck')
  })

  it('truncates a long seller description and omits a blank one', () => {
    const rendered = renderCandidateList([
      { ...candidates[0], description: 'x'.repeat(500) },
      { ...candidates[1], description: '   ' },
    ])
    expect(rendered).toContain(`Seller description: ${'x'.repeat(300)}\n`)
    expect(rendered).not.toContain('x'.repeat(301))
    expect(rendered.match(/Seller description/g)).toHaveLength(1)
  })
})

describe('buildRankingPrompt', () => {
  it('returns the bare prompt without guidance', () => {
    expect(buildRankingPrompt()).toBe(RANKING_PROMPT)
    expect(buildRankingPrompt('   ')).toBe(RANKING_PROMPT)
  })

  it('appends guidance, truncated to the cap', () => {
    const built = buildRankingPrompt('y'.repeat(2500))
    expect(built).toContain('y'.repeat(2000))
    expect(built).not.toContain('y'.repeat(2001))
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/infrastructure/ai/ranking-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "./ranking-prompt"`.

- [ ] **Step 4: Implement the prompt module**

Create `src/infrastructure/ai/ranking-prompt.ts`:

```ts
import type { RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'

export const RANKING_PROMPT = [
  'You are helping a vintage furniture & decor reseller spend a very scarce research',
  'budget: only a couple of the listings below can be investigated further today.',
  'They have all already passed a first triage, so they all look plausible — your job',
  'is to RANK them against each other and keep only the safest bets.',
  'Prefer the piece you are most confident is genuinely vintage, designer or finely',
  'crafted — distinctive form, materials, construction, patina — over the piece with',
  'the most spectacular apparent bargain. An implausibly large gap between the asking',
  'price and the apparent value usually means the piece is not what it looks like.',
  'Reject outright anything mass-market, modern, reproduction, or damaged beyond',
  'value, however cheap it is.',
  'Set worthCredit to false for any candidate you would not spend the budget on, and',
  'do not pad the list: returning fewer picks is better than returning a weak one.',
  'Reply with strict JSON, best candidate first:',
  '{"picks":[{"candidate":<number>,"worthCredit":<true|false>,"reason":"<short>"}]}',
].join(' ')

/**
 * Hard cap on each injected description. Tighter than triage's 600 because a
 * ranking call carries up to 20 candidates at once.
 */
const MAX_DESCRIPTION_CHARS = 300

/** Hard cap on injected guidance length, matching the triage prompt. */
const MAX_GUIDANCE_CHARS = 2000

/**
 * Renders the candidates as a numbered list. The model answers with these numbers
 * rather than database ids: cuids invite transcription errors, and a mangled id
 * cannot be told apart from a hallucinated one, whereas an out-of-range number can.
 */
export function renderCandidateList(candidates: RankingCandidate[]): string {
  return candidates
    .map((candidate, index) => {
      const lines = [
        `Candidate ${index + 1}: ${candidate.title}`,
        `Asking price: ${candidate.priceEur}€`,
      ]
      const description = candidate.description?.trim()
      if (description) {
        lines.push(`Seller description: ${description.slice(0, MAX_DESCRIPTION_CHARS)}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Builds the ranking prompt, optionally appending the guidance distilled from past
 * feedback. The lessons that nuance triage scoring apply just as well to breaking
 * ties between qualified candidates.
 */
export function buildRankingPrompt(guidance?: string | null): string {
  const trimmed = guidance?.trim()
  if (!trimmed) return RANKING_PROMPT
  return [
    RANKING_PROMPT,
    '',
    'Lessons learned from past feedback (listings the user later judged worth it or not). Apply them when ranking:',
    trimmed.slice(0, MAX_GUIDANCE_CHARS),
  ].join('\n')
}

/**
 * Parses a ranking reply into picks ordered best-first.
 *
 * Returns `null` when the reply cannot be parsed at all, and `[]` when the model
 * validly returned no pick. The caller must keep these apart: a parse failure has
 * to fall back to deterministic spending, whereas an empty list is a deliberate
 * abstention that spends nothing.
 */
export function parseRanking(raw: string, candidates: RankingCandidate[]): RankedPick[] | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }

  const picks = (parsed as { picks?: unknown })?.picks
  if (!Array.isArray(picks)) return null

  const seen = new Set<string>()
  const ranked: RankedPick[] = []
  for (const entry of picks) {
    if (typeof entry !== 'object' || entry === null) continue
    const { candidate, worthCredit, reason } = entry as Record<string, unknown>
    if (!Number.isInteger(candidate)) continue
    const match = candidates[(candidate as number) - 1]
    if (!match || seen.has(match.listingId)) continue
    seen.add(match.listingId)
    ranked.push({
      listingId: match.listingId,
      rank: ranked.length + 1,
      // Absent flag means the model listed it without reservation.
      worthCredit: worthCredit !== false,
      reason: typeof reason === 'string' ? reason : undefined,
    })
  }
  return ranked
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/infrastructure/ai/ranking-prompt.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/ISelectionRanker.ts src/infrastructure/ai/ranking-prompt.ts src/infrastructure/ai/ranking-prompt.test.ts
git commit -m "feat(ranking): add selection ranker port and prompt module"
```

---

## Task 2: Gemini ranking adapter

**Files:**
- Create: `src/infrastructure/ai/Gemini/GeminiSelectionRanker.ts`

**Interfaces:**
- Consumes: `ISelectionRanker`, `RankingCandidate`, `RankedPick` from Task 1;
  `buildRankingPrompt`, `renderCandidateList`, `parseRanking` from Task 1.
- Produces: `class GeminiSelectionRanker implements ISelectionRanker`, constructed as
  `new GeminiSelectionRanker(apiKey: string, model?: string)` (model defaults to
  `'gemini-2.5-flash'`).

No unit test: the class is a network shell around the pure module tested in Task 1,
exactly like `GeminiTriageService`, which likewise has no test. Verification is the
typecheck plus the existing suite.

- [ ] **Step 1: Write the adapter**

Create `src/infrastructure/ai/Gemini/GeminiSelectionRanker.ts`:

```ts
import { GoogleGenAI } from '@google/genai'
import type { ISelectionRanker, RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'
import { buildRankingPrompt, parseRanking, renderCandidateList } from '../ranking-prompt'

export class GeminiSelectionRanker implements ISelectionRanker {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]> {
    // A single unreachable image must not sink the whole batch: that candidate is
    // dropped and the others are still ranked. Numbering follows the surviving
    // list so the model's answers keep pointing at the right listing.
    const usable: RankingCandidate[] = []
    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    for (const candidate of candidates) {
      let imageBytes: string
      try {
        imageBytes = Buffer.from(await (await fetch(candidate.imageUrl)).arrayBuffer()).toString('base64')
      } catch {
        continue
      }
      usable.push(candidate)
      imageParts.push({ text: `Candidate ${usable.length}:` })
      imageParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBytes } })
    }
    if (usable.length === 0) return []

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${buildRankingPrompt(guidance)}\n\n${renderCandidateList(usable)}` },
        ...imageParts,
      ],
    })

    const picks = parseRanking(response.text ?? '', usable)
    // Unparseable output is a broken call, not an abstention. Throwing lets the use
    // case fall back to its deterministic order instead of silently spending nothing.
    if (picks === null) throw new Error('Ranking response could not be parsed')
    return picks
  }
}
```

- [ ] **Step 2: Verify it typechecks and nothing regressed**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; the whole suite passes unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/ai/Gemini/GeminiSelectionRanker.ts
git commit -m "feat(ranking): add Gemini selection ranker adapter"
```

---

## Task 3: Windowed budget entitlement

Replaces the daily-budget-plus-fast-track computation with a per-window entitlement.
This task ships on its own: after it, credits are spread across the day instead of
being drained just after midnight, with no ranker involved yet.

**Files:**
- Modify: `src/application/use-cases/RunCompAnalysisUseCase.ts`
- Modify: `src/application/use-cases/RunCompAnalysisUseCase.test.ts`
- Modify: `src/infrastructure/config/env.ts:37-61`
- Modify: `src/infrastructure/di/container.ts:150-160`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces:
  - `LensBudgetConfig` gains `windowsPerDay?: number` and loses
    `fastTrackDailyExtra`, `fastTrackMinScore`, `fastTrackFreshHours`.
  - Exported helper `windowEntitlement(dailyBudget: number, windowsPerDay: number, usedToday: number, now?: Date): number`.

**Note on the existing budget test:** `stops at the remaining daily budget` keeps
passing unchanged, because `windowsPerDay` defaults to 1 and then the entitlement
reduces to the daily budget. The spec anticipated rewriting it; it does not need it.

- [ ] **Step 1: Write the failing tests**

Add to `src/application/use-cases/RunCompAnalysisUseCase.test.ts`. Note the import of
`windowEntitlement` on line 2 and of `beforeEach`/`afterEach` on line 1 — extend the
existing import statements rather than adding new ones.

```ts
describe('windowEntitlement', () => {
  const at = (hour: number) => new Date(2026, 7, 2, hour, 0, 0)

  it('accrues one share of the daily budget per elapsed window', () => {
    expect(windowEntitlement(8, 4, 0, at(1))).toBe(2)
    expect(windowEntitlement(8, 4, 0, at(7))).toBe(4)
    expect(windowEntitlement(8, 4, 0, at(13))).toBe(6)
    expect(windowEntitlement(8, 4, 0, at(23))).toBe(8)
  })

  it('carries an unspent window over to the next one', () => {
    // Nothing spent in window 1: window 2 offers both its own share and the
    // deferred one.
    expect(windowEntitlement(8, 4, 0, at(7))).toBe(4)
    // Two already spent in window 1: window 2 offers only its own share.
    expect(windowEntitlement(8, 4, 2, at(7))).toBe(2)
  })

  it('never goes negative when the day is already overspent', () => {
    expect(windowEntitlement(8, 4, 5, at(1))).toBe(0)
  })

  it('reduces to the plain daily budget with a single window', () => {
    expect(windowEntitlement(8, 1, 7, at(1))).toBe(1)
  })
})
```

And, inside the existing `describe('RunCompAnalysisUseCase')` block:

```ts
  it('spends only the current window entitlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 1, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      expect(d.compService.findComps).toHaveBeenCalledTimes(2)
      expect(res.processed).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets an unspent window carry over into the next one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 7, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9), mk('d', 9), mk('e', 9)] })
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      // Window 2 with nothing spent yet: 2 of its own + 2 carried over.
      expect(res.processed).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the monthly budget above the window entitlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 13, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
      // startOfMonth falls on the 1st, startOfDay on the 2nd: the mock tells the
      // two calls apart by the day of month it is asked about.
      d.budgetRepository.countSince = vi.fn(async (since: Date) => (since.getDate() === 1 ? 249 : 0))
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      // Window 3 would allow 6, the monthly cap allows 1.
      expect(res.processed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
```

- [ ] **Step 2: Delete the fast-track tests**

Remove these three from `RunCompAnalysisUseCase.test.ts` — the lane no longer exists:
- `lets a fresh high-score listing spend the fast-track bonus after the daily budget is gone`
- `fast-track jumps the queue ahead of a higher-scored stale listing`
- `never exceeds the monthly budget even for fast-track listings`

The third one's intent is preserved by the new `keeps the monthly budget above the
window entitlement`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: FAIL — `windowEntitlement is not exported` / not defined.

- [ ] **Step 4: Implement the windowed entitlement**

In `src/application/use-cases/RunCompAnalysisUseCase.ts`:

Replace the three `fastTrack*` fields in `LensBudgetConfig` with:

```ts
  /**
   * Number of equal windows the day is cut into. The daily budget accrues one
   * share per window instead of being available in full at midnight: the comp
   * stage runs every 15 minutes, so a whole-day budget was drained by the first
   * runs after 00:00 on whatever happened to be queued, making "was there at
   * 00:15" the real selection criterion. Defaults to 1 (whole-day budget).
   */
  windowsPerDay?: number
```

Replace the `startOfDay` helper and add the entitlement function:

```ts
function startOfDay(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/**
 * Credits available in the window `now` falls into: the day's budget accrues one
 * share per elapsed window, minus what the day already spent. Unspent windows
 * therefore carry over on their own — an abstaining window leaves `usedToday`
 * untouched, so the next window's accrual absorbs it — while a spending spree
 * cannot borrow from windows that have not elapsed yet.
 */
export function windowEntitlement(
  dailyBudget: number,
  windowsPerDay: number,
  usedToday: number,
  now: Date = new Date(),
): number {
  const msPerWindow = 86_400_000 / windowsPerDay
  const elapsed = Math.floor((now.getTime() - startOfDay(now).getTime()) / msPerWindow) + 1
  const accrued = Math.floor((dailyBudget * elapsed) / windowsPerDay)
  return Math.max(0, accrued - usedToday)
}
```

Replace the budget block in `execute()` (currently the `usedToday` / `fastTrackExtra`
/ `remaining` / `remainingWithBonus` computation) with:

```ts
    const usedToday = await this.budgetRepository.countSince(startOfDay())
    const usedThisMonth = await this.budgetRepository.countSince(startOfMonth())
    let remaining = Math.min(
      windowEntitlement(this.config.dailyBudget, this.config.windowsPerDay ?? 1, usedToday),
      this.config.monthlyBudget - usedThisMonth,
    )
    if (remaining <= 0) return { processed: 0, analyzed: 0, ignored: 0, expired }
```

Replace the `isFastTrack` helper and the candidate sort with:

```ts
    // Best score first; freshness breaks ties so a credit never goes to an old
    // listing while an equally-scored fresh one — still buyable — waits.
    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) =>
        (b.triageScore ?? 0) - (a.triageScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime())
```

In the loop body, replace the fast-track break with:

```ts
      if (remaining <= 0) break
```

and delete the `remainingWithBonus--` line, keeping `remaining--`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: PASS — including the untouched `stops at the remaining daily budget`.

- [ ] **Step 6: Update configuration and wiring**

In `src/infrastructure/config/env.ts`, replace lines 37-39 and 55-61.

Delete `FAST_TRACK_DAILY_EXTRA`, `FAST_TRACK_MIN_SCORE`, `FAST_TRACK_FRESH_HOURS`
with their comment block, and change the budget entry to:

```ts
  // 8/day ≈ 240/month, fits the 250 SerpAPI plan (the account ran dry on
  // 5 Jul 2026 at 8+2). Formerly 6 standard + 2 fast-track; the fast-track lane
  // was folded in when windowed accrual made queue-jumping pointless.
  LENS_DAILY_BUDGET: z.coerce.number().min(0).default(8),
  LENS_MONTHLY_BUDGET: z.coerce.number().min(0).default(250),
  // The day's comp budget accrues one share per window rather than being fully
  // available at midnight. 4 windows = 6h, so a fresh find waits 6h at worst.
  LENS_WINDOWS_PER_DAY: z.coerce.number().min(1).default(4),
```

In `src/infrastructure/di/container.ts`, replace the three `fastTrack*` config lines
with:

```ts
        windowsPerDay: env.LENS_WINDOWS_PER_DAY,
```

- [ ] **Step 7: Verify the whole suite and the typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/application/use-cases/RunCompAnalysisUseCase.ts src/application/use-cases/RunCompAnalysisUseCase.test.ts src/infrastructure/config/env.ts src/infrastructure/di/container.ts
git commit -m "feat(comp): accrue the comp budget per window instead of at midnight"
```

---

## Task 4: Rank the shortlist before spending

**Files:**
- Modify: `src/application/use-cases/RunCompAnalysisUseCase.ts`
- Modify: `src/application/use-cases/RunCompAnalysisUseCase.test.ts`
- Modify: `src/infrastructure/config/env.ts`
- Modify: `src/infrastructure/di/container.ts`

**Interfaces:**
- Consumes: `ISelectionRanker`, `RankingCandidate`, `RankedPick` (Task 1);
  `GeminiSelectionRanker` (Task 2); `windowEntitlement` and the reshaped
  `LensBudgetConfig` (Task 3); the existing `ITriageGuidanceRepository` with
  `getLatest(): Promise<TriageGuidance | null>`.
- Produces:
  - `LensBudgetConfig` gains `rankingShortlistSize?: number`.
  - `execute()` returns `{ processed, analyzed, ignored, expired, deferred }`.
  - Two new optional trailing constructor parameters: `ranker?: ISelectionRanker`,
    `guidanceRepository?: ITriageGuidanceRepository`.

**Restructuring:** the single spend loop becomes two passes. Pass one walks the
sorted candidates applying the free filters (replica, named designer, missing image,
near-duplicate of a past rejection) and stops as soon as `rankingShortlistSize`
survivors are collected — bounding the work, which matters because the pool holds
several hundred rows. Pass two spends credits on the ranker's picks in order,
probing availability only for those. The availability probe therefore moves out of
the filter pass: it is an HTTP request per listing and there is no reason to pay it
for 20 candidates when 2 will be served.

The extra embedding calls in pass one are bounded by the early return added in Task 3:
once a window's credits are spent, `remaining <= 0` returns before any of this runs.

- [ ] **Step 1: Write the failing tests**

Add to `src/application/use-cases/RunCompAnalysisUseCase.test.ts`. Extend the `deps`
helper with a ranker mock by adding this factory next to it:

```ts
const ranker = (picks: any) => ({
  providerName: 'gemini',
  rank: vi.fn(async () => {
    if (picks instanceof Error) throw picks
    return picks
  }),
})
```

Then, inside `describe('RunCompAnalysisUseCase')`:

```ts
  it('spends credits on the ranker picks in rank order', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
    const r = ranker([
      { listingId: 'c', rank: 1, worthCredit: true },
      { listingId: 'a', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank).toHaveBeenCalledTimes(1)
    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['c', 'a'])
  })

  it('skips a pick the ranker judged not worth a credit', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: false },
      { listingId: 'b', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['b'])
  })

  it('defers the whole window when the ranker abstains on everything', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, ranker([]) as any,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(res.processed).toBe(0)
    expect(res.deferred).toBe(2)
  })

  it('falls back to the deterministic order when the ranker throws', async () => {
    const d = deps({ listings: [mk('stale', 9, 80, { createdAt: new Date(2020, 0, 1) }), mk('fresh', 9)] })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 1, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, ranker(new Error('429')) as any,
    )
    const res = await useCase.execute()

    // Equal scores, so freshness decides — and the credit is still spent.
    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['fresh'])
    expect(res.deferred).toBe(0)
  })

  it('caps the shortlist submitted to the ranker', async () => {
    const listings = Array.from({ length: 30 }, (_, i) => mk(`l${i}`, 9))
    const d = deps({ listings })
    const r = ranker([{ listingId: 'l0', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1, rankingShortlistSize: 5 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][0]).toHaveLength(5)
  })

  it('probes availability only for the picks, not the whole shortlist', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
    const availabilityService = { isGone: vi.fn(async () => false) }
    const r = ranker([{ listingId: 'b', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, availabilityService as any, r as any,
    )
    await useCase.execute()

    expect(availabilityService.isGone).toHaveBeenCalledTimes(1)
  })

  it('never offers the ranker a listing the free filters reject', async () => {
    const d = deps({
      listings: [
        mk('replica', 9, 500, { title: 'Table dans le style de Willy Rizzo' }),
        mk('clean', 9),
      ],
    })
    const r = ranker([{ listingId: 'clean', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][0].map((c: any) => c.listingId)).toEqual(['clean'])
    expect(d.statuses['replica']).toBe(ListingStatus.IGNORED)
  })

  it('passes the learned guidance to the ranker', async () => {
    const d = deps({ listings: [mk('a', 9)] })
    const r = ranker([{ listingId: 'a', rank: 1, worthCredit: true }])
    const guidanceRepository = { getLatest: vi.fn(async () => ({ content: 'prefer brass' })) }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any, guidanceRepository as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][1]).toBe('prefer brass')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: FAIL — the ranker argument is ignored, so `r.rank` is never called.

- [ ] **Step 3: Add the config field and constructor dependencies**

In `RunCompAnalysisUseCase.ts`, add to `LensBudgetConfig`:

```ts
  /**
   * How many candidates are submitted to the ranker. Caps both the model call and
   * the free-filter pass that feeds it. Defaults to 20.
   */
  rankingShortlistSize?: number
```

Add the imports:

```ts
import type { ISelectionRanker, RankingCandidate } from '@/domain/services/ISelectionRanker'
import type { ITriageGuidanceRepository } from '@/domain/repositories/ITriageGuidanceRepository'
```

Append two optional parameters to the constructor, after `availabilityService`:

```ts
    // Optional: orders the shortlist so the window's credits go to the safest bets
    // rather than to whichever qualified listing sorted first. Unwired or failing,
    // the deterministic score-then-freshness order stands.
    private ranker?: ISelectionRanker,
    private guidanceRepository?: ITriageGuidanceRepository,
```

- [ ] **Step 4: Extract the free filters into the shortlist pass**

Replace the body of the spend loop up to the availability probe with a first pass
that builds the shortlist. In `execute()`, after the candidate sort:

```ts
    let processed = 0
    let analyzed = 0
    let ignored = 0

    // Pass one: walk the sorted candidates applying the filters that cost nothing,
    // stopping as soon as the shortlist is full. The pool holds several hundred
    // rows, so filtering it whole would mean hundreds of writes and embeddings per
    // run for a handful of credits.
    const shortlistSize = this.config.rankingShortlistSize ?? 20
    const shortlist: typeof candidates = []
    for (const listing of candidates) {
      if (shortlist.length >= shortlistSize) break

      const listingText = `${listing.title} ${listing.description ?? ''}`

      // The seller describes this as a look-alike ("dans le style de", "réplique",
      // "ressemble à <designer>"). It is not the genuine piece, so estimating it
      // against comps of the real designer would be misleading.
      if (hasReplicaSignal(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce décrite comme une imitation / "dans le style de"')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // The seller already names a known designer/maker, so the price is aligned
      // with the piece's value: no hidden margin. The strategy targets pieces whose
      // value the seller did not recognise.
      if (hasKnownDesignerAttribution(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Designer/éditeur déjà nommé par le vendeur (pas de marge cachée)')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // Learn from past feedback: a near-duplicate of a piece already judged "pas
      // intéressant" must not take a shortlist slot. Best-effort — an embedding
      // hiccup must never abort the funnel.
      if (this.feedbackRepository && this.embedder) {
        try {
          const embedding = await this.embedder.embed(listingText)
          const [closest] = await this.feedbackRepository.findSimilar(embedding, 1)
          const threshold = this.config.similarFeedbackSkipThreshold ?? 0.92
          if (closest && !closest.isGood && closest.similarity >= threshold) {
            listing.markAsIgnored()
            const why = closest.comment ? ` ("${closest.comment}")` : ''
            listing.setIgnoreReason(`Similaire à une annonce déjà jugée sans intérêt${why}`)
            await this.listingRepository.update(listing)
            ignored++
            continue
          }
        } catch (err) {
          console.error(`Similar-feedback check failed for ${listing.id}:`, err)
        }
      }

      const images = await this.imageRepository.findByListingId(listing.id)
      if (!images[0]?.urlRemote) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no image for comp search')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      shortlist.push(listing)
    }
```

- [ ] **Step 5: Add the ranking pass and rewrite the spend loop**

Add this private method to the class:

```ts
  /**
   * Orders the shortlist by asking the ranker to compare the candidates against
   * each other. Any failure falls back to the incoming deterministic order: losing
   * ranking quality is acceptable, stalling the funnel is not.
   */
  private async pickInOrder(shortlist: Listing[]): Promise<Listing[]> {
    if (!this.ranker || shortlist.length === 0) return shortlist

    const byId = new Map(shortlist.map((l) => [l.id, l]))
    try {
      const guidance = (await this.guidanceRepository?.getLatest())?.content ?? null
      const candidates: RankingCandidate[] = await Promise.all(
        shortlist.map(async (listing) => ({
          listingId: listing.id,
          imageUrl: (await this.imageRepository.findByListingId(listing.id))[0]!.urlRemote,
          title: listing.title,
          priceEur: listing.price.getEuros(),
          description: listing.description,
        })),
      )
      const picks = await this.ranker.rank(candidates, guidance)
      return picks
        .filter((p) => p.worthCredit)
        .map((p) => byId.get(p.listingId))
        .filter((l): l is Listing => l !== undefined)
    } catch (err) {
      console.error('Selection ranking failed, falling back to deterministic order:', err)
      return shortlist
    }
  }
```

Add the `Listing` type import at the top of the file:

```ts
import type { Listing } from '@/domain/entities/Listing'
```

Then replace the remainder of `execute()` — the spend loop and the return — with:

```ts
    // Pass two: spend the window's credits on the ranker's picks, best first.
    const picks = await this.pickInOrder(shortlist)

    for (const listing of picks) {
      if (remaining <= 0) break

      // A removed listing means the deal is already gone: don't spend a credit
      // estimating a piece nobody can buy. The probe only trusts a definitive
      // 404/410 — an anti-bot block or network error never skips the listing.
      // Probed here, on picks only: it is one HTTP request per listing.
      if (this.availabilityService && await this.availabilityService.isGone(listing.url)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce supprimée de LeBonCoin (vendue ou retirée)')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const images = await this.imageRepository.findByListingId(listing.id)
      const imageUrl = images[0]!.urlRemote

      remaining--
      processed++
      // ...unchanged from here: findComps, recordCall, mass-market check,
      // scoreComps, AiAnalysis.create, save, markAsAnalyzed...
    }

    // Credits the ranker declined to spend. Non-zero day after day means it is too
    // severe; zero with an empty shortlist would be noise, hence the guard.
    const deferred = shortlist.length > 0 ? Math.max(0, remaining) : 0

    return { processed, analyzed, ignored, expired, deferred }
```

Keep the existing body of the loop from `let comps` onward unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/application/use-cases/RunCompAnalysisUseCase.test.ts`
Expected: PASS — new ranking tests plus every pre-existing one.

- [ ] **Step 7: Add configuration and wiring**

In `src/infrastructure/config/env.ts`, next to `LENS_WINDOWS_PER_DAY`:

```ts
  // Candidates submitted to the comparative ranker per window. Absolute triage
  // scoring saturates (967 of 1651 qualified listings scored exactly 9 over the
  // two weeks to 2 Aug 2026), so the ranker, not the score, picks the winners.
  RANKING_SHORTLIST_SIZE: z.coerce.number().min(1).default(20),
  // Kill switch for the ranker call only: the windowed budget still applies and
  // candidates are served in the deterministic score-then-freshness order.
  RANKING_ENABLED: z.coerce.boolean().default(true),
```

In `src/infrastructure/di/container.ts`, add to the config object:

```ts
        rankingShortlistSize: env.RANKING_SHORTLIST_SIZE,
```

and pass the last two constructor arguments, after `new LbcListingAvailabilityChecker()`:

```ts
      env.RANKING_ENABLED && env.GOOGLE_GEMINI_API_KEY
        ? new GeminiSelectionRanker(env.GOOGLE_GEMINI_API_KEY)
        : undefined,
      this.triageGuidanceRepository,
```

Import the adapter at the top of the container:

```ts
import { GeminiSelectionRanker } from '@/infrastructure/ai/Gemini/GeminiSelectionRanker'
```

Check the exact name of the Gemini key in `env.ts` before wiring — the container
already constructs `GeminiTriageService`, so copy the guard it uses there rather than
assuming.

- [ ] **Step 8: Verify the whole suite and the typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/application/use-cases/RunCompAnalysisUseCase.ts src/application/use-cases/RunCompAnalysisUseCase.test.ts src/infrastructure/config/env.ts src/infrastructure/di/container.ts
git commit -m "feat(comp): rank the shortlist before spending comp credits"
```

---

## Deviations from the spec

Three small departures, deliberate:

1. **`RANKING_WINDOWS_PER_DAY` is named `LENS_WINDOWS_PER_DAY`.** It governs the
   accrual of the Lens/SerpAPI budget and belongs beside `LENS_DAILY_BUDGET`, not
   with the ranking knobs — the windowed budget works whether or not ranking is on.
2. **Fallback logging uses `console.error`, not `logError`.** `logError` is the
   route-level convention; `RunCompAnalysisUseCase` already reports its own failures
   with `console.error` and does not import the logger. Matching the file wins.
3. **`stops at the remaining daily budget` is kept, not rewritten.** With
   `windowsPerDay` defaulting to 1 the entitlement collapses to the daily budget, so
   the test still describes real behaviour.

## Verification after all tasks

- [ ] `pnpm exec tsc --noEmit && pnpm test` — clean.
- [ ] `grep -rn "fastTrack\|FAST_TRACK" src/` returns nothing.
- [ ] `grep -rn "deferred" src/application/use-cases/RunCompAnalysisUseCase.ts` shows
      the field is returned.
- [ ] Confirm the three removed env variables are absent from Vercel's project
      settings, and that `LENS_DAILY_BUDGET` is either unset (defaulting to 8) or set
      to 8 — an override left at 6 would silently cut capacity by a quarter.
