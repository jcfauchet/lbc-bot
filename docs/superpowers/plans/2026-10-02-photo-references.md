# Photo References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reseller upload photos of pieces she wants, and email her immediately when a scraped Leboncoin ad shows the same piece at or below her max price.

**Architecture:** A new funnel stage (`RunReferenceMatchUseCase`, first in the `analyze-and-notify` cron) embeds listing photos with Gemini Embedding 2, shortlists active references by pgvector cosine similarity, asks Gemini vision to confirm "same model", records each judged pair in `reference_matches`, and emails confirmed ones. A key-protected mobile page + API let her manage references; every bot email links to that page.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + raw SQL for pgvector, Supabase Postgres, Gemini REST `embedContent` (`gemini-embedding-2-preview`), `@google/genai` 1.30 `generateContent` (`gemini-3.6-flash`), Cloudinary, Resend, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-photo-references-design.md`

## Global Constraints

- All code, identifiers and comments in English; French only in user-facing copy (email templates, the references page), as the existing templates do.
- Commit messages in English, plain, **no `Co-Authored-By` line** (user rule).
- Vectors are `vector(768)`, cosine distance via `<=>`, accessed only through raw SQL (vector columns are NOT declared in `schema.prisma`, same as `listing_feedbacks.embedding`).
- Table for references is `photo_references` (`references` is a reserved SQL word).
- Defaults: `REFERENCE_MATCH_MIN_SIMILARITY=0.75`, `REFERENCE_MATCH_MAX_PER_RUN=60`, 3 photos per listing, 1-5 photos per reference, 7-day backfill window.
- `REFERENCES_KEY` unset ⇒ page/API refuse everything and emails show no references button.
- Vercel function request bodies are capped at 4.5 MB: photos are resized client-side before upload.
- Pushing to `main` deploys and runs `prisma migrate deploy` against production (see `package.json` `build`). The local `.env` `DATABASE_URL` also points at production: never run `prisma migrate dev` or `db push`.
- Test command: `rtk proxy npx vitest --run <path>`; typecheck: `rtk proxy npx tsc --noEmit -p .`.

## Review Focus

1. A phone photo of 4-8 MB (or five of them) → resized client-side to ≤1600px JPEG; the server answers 413 with a readable French message if the body is still too large, never a raw 500. Pinned in Task 8 (`parseReferenceForm` size check).
2. Max price typed as `150 €`, `1 200`, `150,50` or left blank → parsed to cents or `null`; garbage (`abc`) is a 400 with a message, not a silent null. Pinned in Task 8.
3. Gemini verifier replies with fenced JSON, prose, or nothing → treated as `same: false`, never throws past the listing. Pinned in Task 3.
4. One ad matching two references → two recorded pairs, two emails, neither repeated next run. Pinned in Task 5.
5. A reference whose photo embedding failed at upload → embedded on the next run before matching, so it is not silently dead. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20261002000000_photo_references/migration.sql` | New tables, vector columns, indexes, marker column + backlog seed |
| `prisma/schema.prisma` | Prisma models (no vector columns) |
| `src/domain/services/IImageEmbeddingService.ts` | `embedImage(url)` contract |
| `src/domain/services/IReferenceMatchVerifier.ts` | `verify(...)` contract |
| `src/domain/repositories/IReferenceRepository.ts` | All reference persistence + types |
| `src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.ts` | REST embedding adapter |
| `src/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier.ts` | Vision "same model?" adapter |
| `src/infrastructure/ai/reference-match-prompt.ts` | Prompt + tolerant parser |
| `src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts` | Raw-SQL implementation |
| `src/application/use-cases/RunReferenceMatchUseCase.ts` | Stage logic: embed, shortlist, verify, record, alert, backfill |
| `src/infrastructure/mail/EmailTemplates.ts` | `referenceMatch` template + `referencesButton` |
| `src/infrastructure/mail/references-link.ts` | Builds the keyed page URL |
| `src/app/api/references/route.ts`, `[id]/route.ts` | List/create, pause/resume |
| `src/app/api/references/form.ts` | Pure form parsing/validation |
| `src/app/api/references/auth.ts` | Constant-time key check |
| `src/app/feedback/references/page.tsx`, `resize-image.ts` | Mobile page, client-side resize |

---

### Task 1: Gemini image embedding adapter

**Files:**
- Create: `src/domain/services/IImageEmbeddingService.ts`
- Create: `src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.ts`
- Test: `src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.test.ts`
- Test (live, excluded by default): `src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.live.test.ts`

**Interfaces:**
- Produces: `interface IImageEmbeddingService { embedImage(imageUrl: string): Promise<number[]> }`; `class GeminiImageEmbeddingService implements IImageEmbeddingService` with `constructor(apiKey: string, dimensions = 768, model = 'gemini-embedding-2-preview')`; exported const `IMAGE_EMBEDDING_DIMENSIONS = 768`.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GeminiImageEmbeddingService } from './GeminiImageEmbeddingService'

afterEach(() => vi.unstubAllGlobals())

describe('GeminiImageEmbeddingService', () => {
  it('downloads the image and posts it inline to embedContent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: { values: [0.1, 0.2] } })))
    vi.stubGlobal('fetch', fetchMock)

    const vector = await new GeminiImageEmbeddingService('key', 2).embedImage('https://img/x.png')

    expect(vector).toEqual([0.1, 0.2])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent')
    expect(init.headers['x-goog-api-key']).toBe('key')
    const body = JSON.parse(init.body)
    expect(body.content.parts[0].inline_data).toEqual({ mime_type: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') })
    expect(body.output_dimensionality).toBe(2)
  })

  it('throws with the API message when Gemini refuses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })))

    await expect(new GeminiImageEmbeddingService('bad').embedImage('https://img/x.jpg'))
      .rejects.toThrow('Gemini embedContent 400: API key not valid')
  })

  it('throws when the image download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('nope', { status: 404 })))
    await expect(new GeminiImageEmbeddingService('key').embedImage('https://img/gone.jpg'))
      .rejects.toThrow('Image download failed (404)')
  })
})
```

- [ ] **Step 2: Run it, expect failure** — `rtk proxy npx vitest --run src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/domain/services/IImageEmbeddingService.ts
/** Turns an image into a vector comparable by cosine similarity with other images. */
export interface IImageEmbeddingService {
  embedImage(imageUrl: string): Promise<number[]>
}
```

```ts
// src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.ts
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'

export const IMAGE_EMBEDDING_DIMENSIONS = 768

/**
 * Calls the REST endpoint directly: @google/genai 1.30 only embeds text parts,
 * and moving to 2.x is a major bump touching triage and ranking.
 */
export class GeminiImageEmbeddingService implements IImageEmbeddingService {
  constructor(
    private readonly apiKey: string,
    private readonly dimensions = IMAGE_EMBEDDING_DIMENSIONS,
    private readonly model = 'gemini-embedding-2-preview',
  ) {}

  async embedImage(imageUrl: string): Promise<number[]> {
    const image = await fetch(imageUrl)
    if (!image.ok) throw new Error(`Image download failed (${image.status}) for ${imageUrl}`)
    const mimeType = image.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    const data = Buffer.from(await image.arrayBuffer()).toString('base64')

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          content: { parts: [{ inline_data: { mime_type: mimeType, data } }] },
          output_dimensionality: this.dimensions,
        }),
      },
    )
    const json = (await response.json()) as { embedding?: { values?: number[] }; error?: { message?: string } }
    if (!response.ok || !json.embedding?.values) {
      throw new Error(`Gemini embedContent ${response.status}: ${json.error?.message ?? 'no embedding returned'}`)
    }
    return json.embedding.values
  }
}
```

- [ ] **Step 4: Run the unit test** → PASS.

- [ ] **Step 5: Add the live test** (validates the real request shape; excluded from the default suite by `vitest.config.ts`)

```ts
// src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.live.test.ts
import { describe, it, expect } from 'vitest'
import { GeminiImageEmbeddingService } from './GeminiImageEmbeddingService'

describe('GeminiImageEmbeddingService (live)', () => {
  it('returns a 768-dim vector for a real photo', async () => {
    const key = process.env.GOOGLE_GEMINI_API_KEY
    if (!key) throw new Error('GOOGLE_GEMINI_API_KEY required')
    const vector = await new GeminiImageEmbeddingService(key).embedImage(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
    )
    expect(vector).toHaveLength(768)
  })
})
```

Run: `RUN_LIVE=1 rtk proxy npx vitest --run src/infrastructure/ai/Gemini/GeminiImageEmbeddingService.live.test.ts`
Expected: PASS. **The local `.env` Gemini key is known stale (400 "API key not valid")**: if so, ask the user for a valid key (`! export GOOGLE_GEMINI_API_KEY=...` then rerun). If the API rejects the payload shape with a valid key, fix field names here (camelCase `inlineData`/`mimeType`/`outputDimensionality` is the alternative accepted form) before any later task.

- [ ] **Step 6: Commit**

```bash
git add src/domain/services/IImageEmbeddingService.ts src/infrastructure/ai/Gemini/GeminiImageEmbeddingService*.ts
git commit -m "feat(references): Gemini image embedding adapter"
```

---

### Task 2: Schema, migration and repository contract

**Files:**
- Create: `prisma/migrations/20261002000000_photo_references/migration.sql`
- Modify: `prisma/schema.prisma` (add 3 models, relations, `referenceCheckedAt`)
- Create: `src/domain/repositories/IReferenceRepository.ts`

**Interfaces:**
- Produces (used by Tasks 4, 5, 7):

```ts
export interface PhotoReferenceSummary {
  id: string
  name: string
  note: string | null
  maxPriceCents: number | null
  isActive: boolean
  createdAt: Date
  imageUrls: string[]
  matchCount: number
  matchedListingUrls: string[]
}
export interface NewPhotoReference { name: string; note: string | null; maxPriceCents: number | null }
export interface ImageToEmbed { id: string; url: string }
export interface ListingToCheck {
  id: string
  title: string
  priceCents: number
  /** First 3 photos, oldest first. */
  images: Array<{ id: string; url: string; hasEmbedding: boolean }>
}
export interface ReferenceCandidate {
  referenceId: string
  name: string
  note: string | null
  maxPriceCents: number | null
  similarity: number
  imageUrls: string[]
}
export interface RecordedMatch { referenceId: string; listingId: string; similarity: number; confirmed: boolean; reason: string | null }
export interface PendingAlert {
  matchId: string
  referenceName: string
  referenceImageUrl: string | null
  listingId: string
  listingTitle: string
  listingUrl: string
  priceCents: number
  city: string | null
  listingImageUrl: string | null
  reason: string | null
}
export interface IReferenceRepository {
  hasActiveReferences(): Promise<boolean>
  create(reference: NewPhotoReference, imageUrls: string[]): Promise<{ id: string; images: ImageToEmbed[] }>
  list(): Promise<PhotoReferenceSummary[]>
  setActive(id: string, isActive: boolean): Promise<void>
  findReferenceImagesMissingEmbedding(limit: number): Promise<ImageToEmbed[]>
  setReferenceImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  findListingsToCheck(limit: number): Promise<ListingToCheck[]>
  setListingImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  /** Active references close to this listing's photos, excluding pairs already judged. */
  findCandidates(listingId: string, minSimilarity: number): Promise<ReferenceCandidate[]>
  /** Recent listings (embedded photos, not voted down) close to one reference, excluding pairs already judged. */
  findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number): Promise<Array<{ listing: ListingToCheck; candidate: ReferenceCandidate }>>
  recordMatch(match: RecordedMatch): Promise<void>
  markListingChecked(listingId: string): Promise<void>
  findPendingAlerts(): Promise<PendingAlert[]>
  markNotified(matchId: string): Promise<void>
}
```

- [ ] **Step 1: Write the migration**

```sql
-- prisma/migrations/20261002000000_photo_references/migration.sql
CREATE TABLE "photo_references" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxPriceCents" INTEGER,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photo_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reference_images" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "urlRemote" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reference_images_referenceId_idx" ON "reference_images"("referenceId");
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "photo_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reference_matches" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_matches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reference_matches_referenceId_listingId_key" ON "reference_matches"("referenceId", "listingId");
CREATE INDEX "reference_matches_listingId_idx" ON "reference_matches"("listingId");
ALTER TABLE "reference_matches" ADD CONSTRAINT "reference_matches_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "photo_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reference_matches" ADD CONSTRAINT "reference_matches_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "lbc_product_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Listing photo fingerprints, stored so a new reference can be checked against
-- recent ads without re-embedding them.
ALTER TABLE "listing_images" ADD COLUMN "embedding" vector(768);

-- The matching stage's own progress marker, independent of status.
ALTER TABLE "lbc_product_listings" ADD COLUMN "referenceCheckedAt" TIMESTAMP(3);
-- Only the last 7 days are worth checking; older ads are mostly gone.
UPDATE "lbc_product_listings" SET "referenceCheckedAt" = CURRENT_TIMESTAMP
  WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '7 days';
CREATE INDEX "lbc_product_listings_reference_pending_idx"
  ON "lbc_product_listings"("createdAt") WHERE "referenceCheckedAt" IS NULL;
```

No ANN index on the vectors: the reference set is tiny and per-listing queries touch 3 rows, so exact scans are cheaper than ivfflat's recall loss.

- [ ] **Step 2: Update `prisma/schema.prisma`**

In `model LbcProductListing` add after `ignoreReason`:

```prisma
  // Set once the reference-matching stage has compared this listing's photos.
  referenceCheckedAt DateTime?
```

and in its relation block add `referenceMatches ReferenceMatch[]`.

Append:

```prisma
// Vector columns (reference_images.embedding, listing_images.embedding) live in
// the migration SQL only and are accessed through raw queries, like
// listing_feedbacks.embedding.
model PhotoReference {
  id            String           @id @default(cuid())
  name          String
  maxPriceCents Int?
  note          String?          @db.Text
  isActive      Boolean          @default(true)
  createdAt     DateTime         @default(now())
  images        ReferenceImage[]
  matches       ReferenceMatch[]

  @@map("photo_references")
}

model ReferenceImage {
  id          String         @id @default(cuid())
  referenceId String
  urlRemote   String
  createdAt   DateTime       @default(now())
  reference   PhotoReference @relation(fields: [referenceId], references: [id], onDelete: Cascade)

  @@index([referenceId])
  @@map("reference_images")
}

model ReferenceMatch {
  id          String            @id @default(cuid())
  referenceId String
  listingId   String
  similarity  Float
  confirmed   Boolean
  reason      String?           @db.Text
  notifiedAt  DateTime?
  createdAt   DateTime          @default(now())
  reference   PhotoReference    @relation(fields: [referenceId], references: [id], onDelete: Cascade)
  listing     LbcProductListing @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@unique([referenceId, listingId])
  @@index([listingId])
  @@map("reference_matches")
}
```

- [ ] **Step 3: Create `src/domain/repositories/IReferenceRepository.ts`** with exactly the interface block from **Interfaces** above.

- [ ] **Step 4: Regenerate the client and typecheck**

Run: `rtk proxy npx prisma generate && rtk proxy npx tsc --noEmit -p .`
Expected: no errors. Do NOT run `prisma migrate dev` / `db push` (production DB).

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20261002000000_photo_references prisma/schema.prisma src/domain/repositories/IReferenceRepository.ts
git commit -m "feat(references): schema and repository contract for photo references"
```

---

### Task 3: "Same model?" verifier

**Files:**
- Create: `src/domain/services/IReferenceMatchVerifier.ts`
- Create: `src/infrastructure/ai/reference-match-prompt.ts`
- Create: `src/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier.ts`
- Test: `src/infrastructure/ai/reference-match-prompt.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ReferenceVerdict { same: boolean; reason: string | null }
export interface ReferenceMatchInput {
  listingImageUrls: string[]
  listingTitle: string
  referenceImageUrls: string[]
  referenceName: string
  referenceNote: string | null
}
export interface IReferenceMatchVerifier { verify(input: ReferenceMatchInput): Promise<ReferenceVerdict> }
```
`buildReferenceMatchPrompt(input: Pick<ReferenceMatchInput, 'listingTitle' | 'referenceName' | 'referenceNote'> & { listingImageCount: number; referenceImageCount: number }): string`; `parseReferenceVerdict(raw: string): ReferenceVerdict`.

- [ ] **Step 1: Write the failing parser/prompt tests**

```ts
// src/infrastructure/ai/reference-match-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from './reference-match-prompt'

describe('parseReferenceVerdict', () => {
  it('reads strict JSON', () => {
    expect(parseReferenceVerdict('{"same": true, "reason": "same brass frame and glass shelves"}'))
      .toEqual({ same: true, reason: 'same brass frame and glass shelves' })
  })
  it('reads JSON wrapped in a markdown fence', () => {
    expect(parseReferenceVerdict('```json\n{"same": false, "reason": "different legs"}\n```'))
      .toEqual({ same: false, reason: 'different legs' })
  })
  it('treats prose, empty or malformed output as not the same', () => {
    expect(parseReferenceVerdict('I think it might be the same')).toEqual({ same: false, reason: null })
    expect(parseReferenceVerdict('')).toEqual({ same: false, reason: null })
    expect(parseReferenceVerdict('{"same": "yes"')).toEqual({ same: false, reason: null })
  })
  it('requires a real boolean true', () => {
    expect(parseReferenceVerdict('{"same": "true"}')).toEqual({ same: false, reason: null })
  })
})

describe('buildReferenceMatchPrompt', () => {
  it('names the reference, the note and the image order', () => {
    const prompt = buildReferenceMatchPrompt({
      listingTitle: 'Table roulante dorée', referenceName: 'Desserte Jansen', referenceNote: 'plateaux en verre',
      listingImageCount: 2, referenceImageCount: 3,
    })
    expect(prompt).toContain('Desserte Jansen')
    expect(prompt).toContain('plateaux en verre')
    expect(prompt).toContain('Table roulante dorée')
    expect(prompt).toContain('first 2 images')
    expect(prompt).toContain('next 3 images')
  })
})
```

- [ ] **Step 2: Run** `rtk proxy npx vitest --run src/infrastructure/ai/reference-match-prompt.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/domain/services/IReferenceMatchVerifier.ts
export interface ReferenceVerdict { same: boolean; reason: string | null }

export interface ReferenceMatchInput {
  listingImageUrls: string[]
  listingTitle: string
  referenceImageUrls: string[]
  referenceName: string
  referenceNote: string | null
}

/** Decides whether a listing shows the same model/design as a reference piece. */
export interface IReferenceMatchVerifier {
  verify(input: ReferenceMatchInput): Promise<ReferenceVerdict>
}
```

```ts
// src/infrastructure/ai/reference-match-prompt.ts
import type { ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'

export function buildReferenceMatchPrompt(
  input: Pick<ReferenceMatchInput, 'listingTitle' | 'referenceName' | 'referenceNote'> & {
    listingImageCount: number
    referenceImageCount: number
  },
): string {
  return [
    'You help a vintage furniture reseller spot a specific piece she is looking for.',
    `The first ${input.listingImageCount} images are photos from a second-hand listing titled "${input.listingTitle}".`,
    `The next ${input.referenceImageCount} images show her reference piece: "${input.referenceName}".`,
    input.referenceNote ? `Her note about the reference: ${input.referenceNote}` : '',
    'Is the listing the SAME model/design as the reference (same maker or a faithful edition),',
    'judged on form, proportions, materials and construction details? Ignore colour cast,',
    'lighting, background, condition and photo angle. A piece that is merely the same kind of',
    'object or the same style is NOT the same model.',
    'Reply with strict JSON: {"same": true|false, "reason": "<one short sentence>"}',
  ].filter(Boolean).join('\n')
}

/** Anything other than a parseable object with `same: true` counts as no match. */
export function parseReferenceVerdict(raw: string): ReferenceVerdict {
  const object = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return { same: false, reason: null }
  try {
    const parsed = JSON.parse(object) as { same?: unknown; reason?: unknown }
    if (parsed.same !== true && parsed.same !== false) return { same: false, reason: null }
    return { same: parsed.same, reason: typeof parsed.reason === 'string' ? parsed.reason : null }
  } catch {
    return { same: false, reason: null }
  }
}
```

```ts
// src/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier.ts
import { GoogleGenAI } from '@google/genai'
import type { IReferenceMatchVerifier, ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from '../reference-match-prompt'

async function toInlinePart(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`)
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  return { inlineData: { mimeType, data: Buffer.from(await response.arrayBuffer()).toString('base64') } }
}

export class GeminiReferenceMatchVerifier implements IReferenceMatchVerifier {
  private readonly ai: GoogleGenAI

  constructor(apiKey: string, private readonly model = 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey })
  }

  async verify(input: ReferenceMatchInput): Promise<ReferenceVerdict> {
    const listingParts = await Promise.all(input.listingImageUrls.map(toInlinePart))
    const referenceParts = await Promise.all(input.referenceImageUrls.map(toInlinePart))
    const prompt = buildReferenceMatchPrompt({
      listingTitle: input.listingTitle,
      referenceName: input.referenceName,
      referenceNote: input.referenceNote,
      listingImageCount: listingParts.length,
      referenceImageCount: referenceParts.length,
    })
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: prompt }, ...listingParts, ...referenceParts],
    })
    return parseReferenceVerdict(response.text ?? '')
  }
}
```

- [ ] **Step 4: Run tests** → PASS. Then `rtk proxy npx tsc --noEmit -p .` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/IReferenceMatchVerifier.ts src/infrastructure/ai/reference-match-prompt*.ts src/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier.ts
git commit -m "feat(references): Gemini vision verifier for same-model matches"
```

---

### Task 4: Prisma reference repository

**Files:**
- Create: `src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts`

**Interfaces:**
- Consumes: `IReferenceRepository` and its types (Task 2).
- Produces: `class PrismaReferenceRepository implements IReferenceRepository`, `constructor(prisma: PrismaClient)`.

The repo has no DB test harness (other Prisma repositories are untested; the DB is production). Verification is typecheck now, plus the SQL checks in Task 9.

- [ ] **Step 1: Implement**

```ts
// src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts
import { PrismaClient } from '@prisma/client'
import type {
  IReferenceRepository, ImageToEmbed, ListingToCheck, NewPhotoReference, PendingAlert,
  PhotoReferenceSummary, RecordedMatch, ReferenceCandidate,
} from '@/domain/repositories/IReferenceRepository'

const toVector = (embedding: number[]) => `[${embedding.join(',')}]`

type CandidateRow = {
  referenceId: string; name: string; note: string | null; maxPriceCents: number | null
  similarity: number; imageUrls: string[]
}
const toCandidate = (row: CandidateRow): ReferenceCandidate => ({
  referenceId: row.referenceId, name: row.name, note: row.note, maxPriceCents: row.maxPriceCents,
  similarity: Number(row.similarity), imageUrls: row.imageUrls,
})

export class PrismaReferenceRepository implements IReferenceRepository {
  constructor(private prisma: PrismaClient) {}

  async hasActiveReferences(): Promise<boolean> {
    return (await this.prisma.photoReference.count({ where: { isActive: true } })) > 0
  }

  async create(reference: NewPhotoReference, imageUrls: string[]) {
    const created = await this.prisma.photoReference.create({
      data: { ...reference, images: { create: imageUrls.map((urlRemote) => ({ urlRemote })) } },
      include: { images: { orderBy: { createdAt: 'asc' } } },
    })
    return { id: created.id, images: created.images.map((i) => ({ id: i.id, url: i.urlRemote })) }
  }

  async list(): Promise<PhotoReferenceSummary[]> {
    const rows = await this.prisma.photoReference.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        images: { orderBy: { createdAt: 'asc' } },
        matches: { where: { confirmed: true }, include: { listing: { select: { url: true } } }, orderBy: { createdAt: 'desc' } },
      },
    })
    return rows.map((r) => ({
      id: r.id, name: r.name, note: r.note, maxPriceCents: r.maxPriceCents, isActive: r.isActive,
      createdAt: r.createdAt, imageUrls: r.images.map((i) => i.urlRemote),
      matchCount: r.matches.length, matchedListingUrls: r.matches.map((m) => m.listing.url),
    }))
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.prisma.photoReference.update({ where: { id }, data: { isActive } })
  }

  async findReferenceImagesMissingEmbedding(limit: number): Promise<ImageToEmbed[]> {
    return this.prisma.$queryRaw<ImageToEmbed[]>`
      SELECT "id", "urlRemote" AS "url" FROM "reference_images"
      WHERE "embedding" IS NULL ORDER BY "createdAt" ASC LIMIT ${limit}
    `
  }

  async setReferenceImageEmbedding(imageId: string, embedding: number[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "reference_images" SET "embedding" = ${toVector(embedding)}::vector WHERE "id" = ${imageId}
    `
  }

  async findListingsToCheck(limit: number): Promise<ListingToCheck[]> {
    const listings = await this.prisma.$queryRaw<Array<{ id: string; title: string; priceCents: number }>>`
      SELECT p."id", p."title", p."priceCents" FROM "lbc_product_listings" p
      WHERE p."referenceCheckedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "listing_feedbacks" f WHERE f."listingId" = p."id" AND f."isGood" = false)
      ORDER BY p."createdAt" DESC LIMIT ${limit}
    `
    return this.attachImages(listings)
  }

  async setListingImageEmbedding(imageId: string, embedding: number[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "listing_images" SET "embedding" = ${toVector(embedding)}::vector WHERE "id" = ${imageId}
    `
  }

  async findCandidates(listingId: string, minSimilarity: number): Promise<ReferenceCandidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT r."id" AS "referenceId", r."name", r."note", r."maxPriceCents",
             MAX(1 - (li."embedding" <=> ri."embedding")) AS "similarity",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "listing_images" li
      JOIN "reference_images" ri ON ri."embedding" IS NOT NULL
      JOIN "photo_references" r ON r."id" = ri."referenceId" AND r."isActive"
      WHERE li."listingId" = ${listingId} AND li."embedding" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = ${listingId})
      GROUP BY r."id"
      HAVING MAX(1 - (li."embedding" <=> ri."embedding")) >= ${minSimilarity}
      ORDER BY "similarity" DESC
    `
    return rows.map(toCandidate)
  }

  async findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number) {
    const rows = await this.prisma.$queryRaw<Array<CandidateRow & { listingId: string; title: string; priceCents: number }>>`
      SELECT p."id" AS "listingId", p."title", p."priceCents",
             r."id" AS "referenceId", r."name", r."note", r."maxPriceCents",
             MAX(1 - (li."embedding" <=> ri."embedding")) AS "similarity",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "lbc_product_listings" p
      JOIN "listing_images" li ON li."listingId" = p."id" AND li."embedding" IS NOT NULL
      JOIN "reference_images" ri ON ri."referenceId" = ${referenceId} AND ri."embedding" IS NOT NULL
      JOIN "photo_references" r ON r."id" = ri."referenceId" AND r."isActive"
      WHERE p."createdAt" >= NOW() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM "listing_feedbacks" f WHERE f."listingId" = p."id" AND f."isGood" = false)
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
      GROUP BY p."id", r."id"
      HAVING MAX(1 - (li."embedding" <=> ri."embedding")) >= ${minSimilarity}
      ORDER BY "similarity" DESC
    `
    const listings = await this.attachImages(rows.map((r) => ({ id: r.listingId, title: r.title, priceCents: r.priceCents })))
    return rows.map((row, i) => ({ listing: listings[i], candidate: toCandidate(row) }))
  }

  async recordMatch(match: RecordedMatch): Promise<void> {
    // The unique (referenceId, listingId) pair makes a concurrent double-judgement a no-op.
    await this.prisma.referenceMatch.upsert({
      where: { referenceId_listingId: { referenceId: match.referenceId, listingId: match.listingId } },
      create: match,
      update: {},
    })
  }

  async markListingChecked(listingId: string): Promise<void> {
    await this.prisma.lbcProductListing.update({ where: { id: listingId }, data: { referenceCheckedAt: new Date() } })
  }

  async findPendingAlerts(): Promise<PendingAlert[]> {
    const rows = await this.prisma.referenceMatch.findMany({
      where: { confirmed: true, notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        reference: { include: { images: { orderBy: { createdAt: 'asc' }, take: 1 } } },
        listing: { include: { images: { orderBy: { createdAt: 'asc' }, take: 1 } } },
      },
    })
    return rows.map((m) => ({
      matchId: m.id,
      referenceName: m.reference.name,
      referenceImageUrl: m.reference.images[0]?.urlRemote ?? null,
      listingId: m.listingId,
      listingTitle: m.listing.title,
      listingUrl: m.listing.url,
      priceCents: m.listing.priceCents,
      city: m.listing.city,
      listingImageUrl: m.listing.images[0]?.urlRemote ?? null,
      reason: m.reason,
    }))
  }

  async markNotified(matchId: string): Promise<void> {
    await this.prisma.referenceMatch.update({ where: { id: matchId }, data: { notifiedAt: new Date() } })
  }

  private async attachImages(listings: Array<{ id: string; title: string; priceCents: number }>): Promise<ListingToCheck[]> {
    if (listings.length === 0) return []
    const ids = listings.map((l) => l.id)
    const images = await this.prisma.$queryRaw<Array<{ id: string; listingId: string; url: string; hasEmbedding: boolean }>>`
      SELECT "id", "listingId", "urlRemote" AS "url", ("embedding" IS NOT NULL) AS "hasEmbedding"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "listingId" ORDER BY "createdAt", "id") AS rn
        FROM "listing_images" WHERE "listingId" = ANY(${ids})
      ) ranked
      WHERE rn <= 3
      ORDER BY "listingId", rn
    `
    return listings.map((l) => ({
      ...l,
      images: images.filter((i) => i.listingId === l.id).map(({ id, url, hasEmbedding }) => ({ id, url, hasEmbedding })),
    }))
  }
}
```

- [ ] **Step 2: Typecheck** — `rtk proxy npx tsc --noEmit -p .` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts
git commit -m "feat(references): Prisma repository with pgvector candidate queries"
```

---

### Task 5: Matching stage use case (match, alert, backfill)

**Files:**
- Create: `src/application/use-cases/RunReferenceMatchUseCase.ts`
- Test: `src/application/use-cases/RunReferenceMatchUseCase.test.ts`
- Modify: `src/infrastructure/mail/EmailTemplates.ts` (add `referenceMatch`)

**Interfaces:**
- Consumes: `IReferenceRepository` (Task 2), `IImageEmbeddingService` (Task 1), `IReferenceMatchVerifier` (Task 3), `IMailer` from `@/infrastructure/mail/IMailer`.
- Produces:

```ts
export interface ReferenceMatchConfig { minSimilarity: number; maxListingsPerRun: number; backfillDays: number; emailTo: string[]; emailFrom: string }
export interface ReferenceMatchResult { checked: number; failed: number; judged: number; confirmed: number; alerted: number }
export class RunReferenceMatchUseCase {
  constructor(repo: IReferenceRepository, embedder: IImageEmbeddingService, verifier: IReferenceMatchVerifier, mailer: IMailer, config: ReferenceMatchConfig)
  execute(): Promise<ReferenceMatchResult>
  /** Called right after a reference is created. */
  backfill(referenceId: string): Promise<ReferenceMatchResult>
}
```
`EmailTemplates.referenceMatch(alert: PendingAlert): { subject: string; html: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/application/use-cases/RunReferenceMatchUseCase.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RunReferenceMatchUseCase } from './RunReferenceMatchUseCase'
import type { ListingToCheck, PendingAlert, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'

const listing = (id: string, priceCents = 12000, embedded = false): ListingToCheck => ({
  id, title: `title ${id}`, priceCents,
  images: [{ id: `${id}-img`, url: `https://img/${id}.jpg`, hasEmbedding: embedded }],
})
const candidate = (referenceId: string, overrides: Partial<ReferenceCandidate> = {}): ReferenceCandidate => ({
  referenceId, name: `ref ${referenceId}`, note: null, maxPriceCents: null, similarity: 0.8,
  imageUrls: [`https://ref/${referenceId}.jpg`], ...overrides,
})
const alert = (matchId: string): PendingAlert => ({
  matchId, referenceName: 'Desserte Jansen', referenceImageUrl: 'https://ref/a.jpg', listingId: 'l1',
  listingTitle: 'Table roulante', listingUrl: 'https://lbc/l1', priceCents: 12000, city: 'Lyon',
  listingImageUrl: 'https://img/l1.jpg', reason: 'same frame',
})

function setup(opts: {
  active?: boolean
  listings?: ListingToCheck[]
  candidates?: Record<string, ReferenceCandidate[]>
  verdict?: (referenceId: string) => { same: boolean; reason: string | null }
  pending?: PendingAlert[]
  missingRefImages?: Array<{ id: string; url: string }>
} = {}) {
  const recorded: any[] = []
  const repo = {
    hasActiveReferences: vi.fn(async () => opts.active ?? true),
    findReferenceImagesMissingEmbedding: vi.fn(async () => opts.missingRefImages ?? []),
    setReferenceImageEmbedding: vi.fn(async () => {}),
    findListingsToCheck: vi.fn(async () => opts.listings ?? []),
    setListingImageEmbedding: vi.fn(async () => {}),
    findCandidates: vi.fn(async (listingId: string) => opts.candidates?.[listingId] ?? []),
    findRecentListingsCloseTo: vi.fn(async () => []),
    recordMatch: vi.fn(async (m: any) => { recorded.push(m) }),
    markListingChecked: vi.fn(async () => {}),
    findPendingAlerts: vi.fn(async () => opts.pending ?? []),
    markNotified: vi.fn(async () => {}),
  }
  const embedder = { embedImage: vi.fn(async () => [0.1, 0.2]) }
  const verifier = { verify: vi.fn(async (input: any) => (opts.verdict ?? (() => ({ same: true, reason: 'same' })))(input.referenceName.replace('ref ', ''))) }
  const mailer = { send: vi.fn(async () => {}) }
  const useCase = new RunReferenceMatchUseCase(repo as any, embedder, verifier, mailer, {
    minSimilarity: 0.75, maxListingsPerRun: 60, backfillDays: 7, emailTo: ['her@example.com'], emailFrom: 'bot@example.com',
  })
  return { repo, embedder, verifier, mailer, useCase, recorded }
}

describe('RunReferenceMatchUseCase', () => {
  it('does nothing when no reference is active', async () => {
    const { repo, useCase } = setup({ active: false, listings: [listing('l1')] })
    const res = await useCase.execute()
    expect(repo.findListingsToCheck).not.toHaveBeenCalled()
    expect(res).toEqual({ checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 })
  })

  it('embeds reference images that failed at upload before matching', async () => {
    const { repo, embedder, useCase } = setup({ missingRefImages: [{ id: 'ri1', url: 'https://ref/1.jpg' }] })
    await useCase.execute()
    expect(embedder.embedImage).toHaveBeenCalledWith('https://ref/1.jpg')
    expect(repo.setReferenceImageEmbedding).toHaveBeenCalledWith('ri1', [0.1, 0.2])
    expect(repo.setReferenceImageEmbedding.mock.invocationCallOrder[0])
      .toBeLessThan(repo.findListingsToCheck.mock.invocationCallOrder[0])
  })

  it('embeds only listing photos without an embedding', async () => {
    const l = listing('l1')
    l.images.push({ id: 'l1-img2', url: 'https://img/l1b.jpg', hasEmbedding: true })
    const { repo, embedder, useCase } = setup({ listings: [l] })
    await useCase.execute()
    expect(embedder.embedImage).toHaveBeenCalledTimes(1)
    expect(repo.setListingImageEmbedding).toHaveBeenCalledWith('l1-img', [0.1, 0.2])
    expect(repo.markListingChecked).toHaveBeenCalledWith('l1')
  })

  it('records a confirmed match and checks the listing', async () => {
    const { verifier, recorded, useCase } = setup({ listings: [listing('l1')], candidates: { l1: [candidate('a')] } })
    const res = await useCase.execute()
    expect(verifier.verify).toHaveBeenCalledWith({
      listingImageUrls: ['https://img/l1.jpg'], listingTitle: 'title l1',
      referenceImageUrls: ['https://ref/a.jpg'], referenceName: 'ref a', referenceNote: null,
    })
    expect(recorded).toEqual([{ referenceId: 'a', listingId: 'l1', similarity: 0.8, confirmed: true, reason: 'same' }])
    expect(res.confirmed).toBe(1)
  })

  it('records a rejected verdict so the pair is never asked again', async () => {
    const { recorded, useCase } = setup({
      listings: [listing('l1')], candidates: { l1: [candidate('a')] },
      verdict: () => ({ same: false, reason: 'different legs' }),
    })
    const res = await useCase.execute()
    expect(recorded[0]).toMatchObject({ confirmed: false, reason: 'different legs' })
    expect(res.confirmed).toBe(0)
  })

  it('skips a reference whose max price is below the asking price without asking Gemini', async () => {
    const { verifier, recorded, useCase } = setup({
      listings: [listing('l1', 30000)], candidates: { l1: [candidate('a', { maxPriceCents: 15000 })] },
    })
    await useCase.execute()
    expect(verifier.verify).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  it('records one pair per reference when a listing matches two references', async () => {
    const { recorded, useCase } = setup({ listings: [listing('l1')], candidates: { l1: [candidate('a'), candidate('b')] } })
    await useCase.execute()
    expect(recorded.map((m) => m.referenceId)).toEqual(['a', 'b'])
  })

  it('keeps going when one listing fails, and leaves the failed one unchecked', async () => {
    const { repo, embedder, useCase } = setup({ listings: [listing('bad'), listing('good')] })
    embedder.embedImage.mockImplementationOnce(async () => { throw new Error('gemini down') })
    const res = await useCase.execute()
    expect(repo.markListingChecked).toHaveBeenCalledTimes(1)
    expect(repo.markListingChecked).toHaveBeenCalledWith('good')
    expect(res).toMatchObject({ checked: 1, failed: 1 })
  })

  it('emails each pending alert once and marks it notified', async () => {
    const { mailer, repo, useCase } = setup({ pending: [alert('m1'), alert('m2')] })
    const res = await useCase.execute()
    expect(mailer.send).toHaveBeenCalledTimes(2)
    expect(mailer.send.mock.calls[0][0]).toMatchObject({ to: ['her@example.com'], from: 'bot@example.com', subject: '🎯 Ressemble à ta référence : Desserte Jansen' })
    expect(repo.markNotified).toHaveBeenCalledWith('m1')
    expect(repo.markNotified).toHaveBeenCalledWith('m2')
    expect(res.alerted).toBe(2)
  })

  it('leaves an alert pending when the send fails', async () => {
    const { mailer, repo, useCase } = setup({ pending: [alert('m1')] })
    mailer.send.mockRejectedValueOnce(new Error('resend down'))
    const res = await useCase.execute()
    expect(repo.markNotified).not.toHaveBeenCalled()
    expect(res.alerted).toBe(0)
  })

  it('backfill judges recent close listings for the new reference and sends alerts', async () => {
    const { repo, verifier, mailer, useCase, recorded } = setup({ pending: [alert('m1')] })
    repo.findRecentListingsCloseTo.mockResolvedValueOnce([{ listing: listing('old', 12000, true), candidate: candidate('new') }])
    const res = await useCase.backfill('new')
    expect(repo.findRecentListingsCloseTo).toHaveBeenCalledWith('new', 0.75, 7)
    expect(verifier.verify).toHaveBeenCalledOnce()
    expect(recorded[0]).toMatchObject({ referenceId: 'new', listingId: 'old', confirmed: true })
    expect(mailer.send).toHaveBeenCalledOnce()
    expect(res).toMatchObject({ judged: 1, confirmed: 1, alerted: 1 })
  })
})
```

- [ ] **Step 2: Run** `rtk proxy npx vitest --run src/application/use-cases/RunReferenceMatchUseCase.test.ts` → FAIL (module not found).

- [ ] **Step 3: Add the email template** — append inside `class EmailTemplates` in `src/infrastructure/mail/EmailTemplates.ts` (add `import type { PendingAlert } from '@/domain/repositories/IReferenceRepository'` at the top):

```ts
  static referenceMatch(alert: PendingAlert): { subject: string; html: string } {
    const price = `${(alert.priceCents / 100).toFixed(0)} €`
    const photo = (url: string | null, caption: string) => url
      ? `<td style="width: 50%; padding: 6px; vertical-align: top; text-align: center;">
           <img src="${url}" alt="${caption}" style="width: 100%; max-width: 280px; border-radius: 8px; border: 1px solid #ddd;" />
           <div style="font-size: 12px; color: #666; margin-top: 4px;">${caption}</div>
         </td>`
      : ''
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 22px; margin: 0 0 6px 0;">🎯 Ça ressemble à ta référence</h1>
  <p style="margin: 0 0 16px 0; color: #666;">${alert.referenceName}</p>
  <table style="width: 100%; border-collapse: collapse;"><tr>
    ${photo(alert.listingImageUrl, 'Annonce')}
    ${photo(alert.referenceImageUrl, 'Ta référence')}
  </tr></table>
  <h2 style="font-size: 18px; margin: 16px 0 4px 0;">
    <a href="${alert.listingUrl}" style="color: #0066cc; text-decoration: none;">${alert.listingTitle}</a>
  </h2>
  <p style="margin: 0; font-size: 22px; font-weight: bold; color: #ff6b00;">${price}</p>
  ${alert.city ? `<p style="margin: 2px 0; color: #666;">${alert.city}</p>` : ''}
  ${alert.reason ? `<p style="margin: 10px 0; color: #333;"><strong>Pourquoi :</strong> ${alert.reason}</p>` : ''}
  <p style="margin: 16px 0;">
    <a href="${alert.listingUrl}" style="display: inline-block; background: #ff6b00; color: white; text-decoration: none; font-weight: bold; padding: 12px 22px; border-radius: 8px;">Voir l'annonce</a>
  </p>
  <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; color: #999;">
    C'est bien la même pièce ?
    <a href="${env.APP_URL}/feedback?id=${alert.listingId}&vote=good" style="margin-left: 8px; color: #22c55e; text-decoration: none; font-weight: bold;">👍 Oui</a>
    <a href="${env.APP_URL}/feedback?id=${alert.listingId}&vote=bad" style="margin-left: 8px; color: #ef4444; text-decoration: none; font-weight: bold;">👎 Non</a>
  </div>
</body>
</html>`
    return { subject: `🎯 Ressemble à ta référence : ${alert.referenceName}`, html }
  }
```

(Task 7 adds the "Ajouter des références" button to both templates.)

- [ ] **Step 4: Implement the use case**

```ts
// src/application/use-cases/RunReferenceMatchUseCase.ts
import type { IReferenceRepository, ListingToCheck, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { IReferenceMatchVerifier } from '@/domain/services/IReferenceMatchVerifier'
import type { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'

export interface ReferenceMatchConfig {
  /** Cosine similarity from which Gemini is asked to confirm. Deliberately loose. */
  minSimilarity: number
  maxListingsPerRun: number
  backfillDays: number
  emailTo: string[]
  emailFrom: string
}

export interface ReferenceMatchResult { checked: number; failed: number; judged: number; confirmed: number; alerted: number }

/** Reference photos whose embedding failed at upload, retried per run. */
const REFERENCE_IMAGE_RETRY_BATCH = 20

/**
 * Spots ads showing a piece the reseller uploaded as a reference, and alerts her
 * immediately. Runs before prefilter/triage on purpose: a reference match must
 * not depend on the triage score or on the comp budget.
 */
export class RunReferenceMatchUseCase {
  constructor(
    private repo: IReferenceRepository,
    private embedder: IImageEmbeddingService,
    private verifier: IReferenceMatchVerifier,
    private mailer: IMailer,
    private config: ReferenceMatchConfig,
  ) {}

  async execute(): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    if (!(await this.repo.hasActiveReferences())) return result

    for (const image of await this.repo.findReferenceImagesMissingEmbedding(REFERENCE_IMAGE_RETRY_BATCH)) {
      try {
        await this.repo.setReferenceImageEmbedding(image.id, await this.embedder.embedImage(image.url))
      } catch (err) {
        console.error(`Reference image embedding failed for ${image.id}:`, err)
      }
    }

    for (const listing of await this.repo.findListingsToCheck(this.config.maxListingsPerRun)) {
      // One listing failing (dead image URL, Gemini hiccup) must not stop the run;
      // its marker stays NULL so the next run retries it.
      try {
        await this.embedListingImages(listing)
        for (const candidate of await this.repo.findCandidates(listing.id, this.config.minSimilarity)) {
          await this.judge(listing, candidate, result)
        }
        await this.repo.markListingChecked(listing.id)
        result.checked++
      } catch (err) {
        console.error(`Reference matching failed for ${listing.id}:`, err)
        result.failed++
      }
    }

    result.alerted = await this.sendPendingAlerts()
    return result
  }

  async backfill(referenceId: string): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    const close = await this.repo.findRecentListingsCloseTo(referenceId, this.config.minSimilarity, this.config.backfillDays)
    for (const { listing, candidate } of close) {
      try {
        await this.judge(listing, candidate, result)
      } catch (err) {
        console.error(`Reference backfill failed for ${listing.id}:`, err)
        result.failed++
      }
    }
    result.alerted = await this.sendPendingAlerts()
    return result
  }

  private async embedListingImages(listing: ListingToCheck): Promise<void> {
    await Promise.all(listing.images.filter((i) => !i.hasEmbedding).map(async (image) => {
      await this.repo.setListingImageEmbedding(image.id, await this.embedder.embedImage(image.url))
    }))
  }

  private async judge(listing: ListingToCheck, candidate: ReferenceCandidate, result: ReferenceMatchResult): Promise<void> {
    if (candidate.maxPriceCents !== null && listing.priceCents > candidate.maxPriceCents) return

    const verdict = await this.verifier.verify({
      listingImageUrls: listing.images.map((i) => i.url),
      listingTitle: listing.title,
      referenceImageUrls: candidate.imageUrls,
      referenceName: candidate.name,
      referenceNote: candidate.note,
    })
    await this.repo.recordMatch({
      referenceId: candidate.referenceId,
      listingId: listing.id,
      similarity: candidate.similarity,
      confirmed: verdict.same,
      reason: verdict.reason,
    })
    result.judged++
    if (verdict.same) result.confirmed++
  }

  private async sendPendingAlerts(): Promise<number> {
    let sent = 0
    for (const alert of await this.repo.findPendingAlerts()) {
      try {
        const { subject, html } = EmailTemplates.referenceMatch(alert)
        await this.mailer.send({ to: this.config.emailTo, from: this.config.emailFrom, subject, html })
        await this.repo.markNotified(alert.matchId)
        sent++
      } catch (err) {
        console.error(`Reference alert failed for match ${alert.matchId}:`, err)
      }
    }
    return sent
  }
}
```

- [ ] **Step 5: Run the tests** → all PASS. Then the full suite `rtk proxy npx vitest --run` and `rtk proxy npx tsc --noEmit -p .` → green.

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/RunReferenceMatchUseCase*.ts src/infrastructure/mail/EmailTemplates.ts
git commit -m "feat(references): matching stage with immediate alert emails"
```

---

### Task 6: Wire the stage into the funnel

**Files:**
- Modify: `src/infrastructure/config/env.ts` (3 vars)
- Modify: `src/infrastructure/di/container.ts`
- Modify: `src/app/api/cron/analyze-and-notify/route.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5.
- Produces: `container.referenceRepository: PrismaReferenceRepository`, `container.imageEmbeddingService: GeminiImageEmbeddingService`, `container.runReferenceMatchUseCase: RunReferenceMatchUseCase`; `env.REFERENCES_KEY?: string`, `env.REFERENCE_MATCH_MIN_SIMILARITY: number`, `env.REFERENCE_MATCH_MAX_PER_RUN: number`.

- [ ] **Step 1: env vars** — add to `envSchema` in `src/infrastructure/config/env.ts`, after `MASS_MARKET_MIN_MATCHES`:

```ts
  // Secret in the references page link (/feedback/references?k=...). Unset locks
  // the page and API and hides the button in emails.
  REFERENCES_KEY: z.string().min(16).optional(),
  // Cosine similarity between listing and reference photos from which Gemini is
  // asked "same model?". Deliberately loose at launch; tune from reference_matches.
  REFERENCE_MATCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.75),
  // ~500 new ads/day over 96 runs/day; 60 also drains the 7-day backlog in a day.
  REFERENCE_MATCH_MAX_PER_RUN: z.coerce.number().int().min(1).default(60),
```

- [ ] **Step 2: container** — in `src/infrastructure/di/container.ts` add imports:

```ts
import { PrismaReferenceRepository } from '@/infrastructure/prisma/repositories/PrismaReferenceRepository'
import { GeminiImageEmbeddingService } from '@/infrastructure/ai/Gemini/GeminiImageEmbeddingService'
import { GeminiReferenceMatchVerifier } from '@/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier'
import { RunReferenceMatchUseCase } from '@/application/use-cases/RunReferenceMatchUseCase'
```

fields:

```ts
  public readonly referenceRepository: PrismaReferenceRepository
  public readonly imageEmbeddingService: GeminiImageEmbeddingService
  public readonly runReferenceMatchUseCase: RunReferenceMatchUseCase
```

and in the constructor, after `this.mailer = new ResendMailer(resendApiKey)`:

```ts
    this.referenceRepository = new PrismaReferenceRepository(this.prisma)
    this.imageEmbeddingService = new GeminiImageEmbeddingService(geminiApiKey)
    this.runReferenceMatchUseCase = new RunReferenceMatchUseCase(
      this.referenceRepository,
      this.imageEmbeddingService,
      new GeminiReferenceMatchVerifier(geminiApiKey),
      this.mailer,
      {
        minSimilarity: env.REFERENCE_MATCH_MIN_SIMILARITY,
        maxListingsPerRun: env.REFERENCE_MATCH_MAX_PER_RUN,
        backfillDays: 7,
        emailTo: env.NOTIFICATION_EMAIL_TO,
        emailFrom: env.NOTIFICATION_EMAIL_FROM ?? 'LBC Bot <bot@example.com>',
      },
    )
```

- [ ] **Step 3: cron stage** — in `src/app/api/cron/analyze-and-notify/route.ts`, before the `prefilter` line:

```ts
  // First: a reference match must not depend on prefilter, triage score or comp budget.
  const references = await runStage('references', () => container.runReferenceMatchUseCase.execute())
```

and change `const stages = { prefilter, triage, analysis, notification }` to `const stages = { references, prefilter, triage, analysis, notification }`. Update the comment above `maxDuration` to read `(references→prefilter→triage→comp→notify)`.

- [ ] **Step 4: Verify** — `rtk proxy npx tsc --noEmit -p .` and `rtk proxy npx vitest --run` → green.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/config/env.ts src/infrastructure/di/container.ts src/app/api/cron/analyze-and-notify/route.ts
git commit -m "feat(references): run reference matching first in the funnel cron"
```

---

### Task 7: "Ajouter des références" button in every bot email

**Files:**
- Create: `src/infrastructure/mail/references-link.ts`
- Test: `src/infrastructure/mail/references-link.test.ts`
- Modify: `src/infrastructure/mail/EmailTemplates.ts`

**Interfaces:**
- Produces: `referencesPageUrl(appUrl: string, key: string | undefined): string | null`; `EmailTemplates.referencesButton(): string` (empty string when no key).

- [ ] **Step 1: Failing test**

```ts
// src/infrastructure/mail/references-link.test.ts
import { describe, it, expect } from 'vitest'
import { referencesPageUrl } from './references-link'

describe('referencesPageUrl', () => {
  it('builds the keyed page URL', () => {
    expect(referencesPageUrl('https://bot.example.com', 'abc def/123'))
      .toBe('https://bot.example.com/feedback/references?k=abc%20def%2F123')
  })
  it('is null without a key, so emails hide the button', () => {
    expect(referencesPageUrl('https://bot.example.com', undefined)).toBeNull()
    expect(referencesPageUrl('https://bot.example.com', '')).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `rtk proxy npx vitest --run src/infrastructure/mail/references-link.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/infrastructure/mail/references-link.ts
/** Link to the references page, keyed so she never has to look it up. */
export function referencesPageUrl(appUrl: string, key: string | undefined): string | null {
  if (!key) return null
  return `${appUrl}/feedback/references?k=${encodeURIComponent(key)}`
}
```

In `EmailTemplates.ts` add `import { referencesPageUrl } from './references-link'` and inside the class:

```ts
  /** Always-at-hand link to the references page; empty when the feature is locked. */
  static referencesButton(): string {
    const url = referencesPageUrl(env.APP_URL, env.REFERENCES_KEY)
    if (!url) return ''
    return `
    <a href="${url}"
       style="display: inline-block; background: #ff6b00; color: white; text-decoration: none;
              font-weight: bold; padding: 12px 22px; border-radius: 8px; margin: 6px;">
      📸 Ajouter des références
    </a>`
  }
```

In `goodDealsDigest`, inside the existing top block, put the new button next to the inbox one: replace

```html
      🗳️ Noter toutes les annonces sur une page
    </a>
```

with

```html
      🗳️ Noter toutes les annonces sur une page
    </a>
    ${EmailTemplates.referencesButton()}
```

In `referenceMatch`, right after the "Voir l'annonce" `<p>` block, add:

```html
  <p style="margin: 0 0 16px 0;">${EmailTemplates.referencesButton()}</p>
```

- [ ] **Step 4: Run** the new test plus `src/infrastructure/mail` and the use-case tests → PASS; `rtk proxy npx tsc --noEmit -p .` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/mail/references-link*.ts src/infrastructure/mail/EmailTemplates.ts
git commit -m "feat(references): add-references button in every bot email"
```

---

### Task 8: References API (key check, form parsing, upload, backfill)

**Files:**
- Create: `src/app/api/references/auth.ts`
- Create: `src/app/api/references/form.ts`
- Test: `src/app/api/references/form.test.ts`
- Test: `src/app/api/references/auth.test.ts`
- Create: `src/app/api/references/route.ts`
- Create: `src/app/api/references/[id]/route.ts`
- Modify: `src/infrastructure/storage/IStorageService.ts`, `src/infrastructure/storage/CloudinaryStorageService.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `container.referenceRepository`, `container.imageEmbeddingService`, `container.runReferenceMatchUseCase`, `container.storageService` (Task 6).
- Produces: `isReferencesKeyValid(provided: string | null, expected: string | undefined): boolean`; `parseReferenceForm(input: { name: unknown; maxPrice: unknown; note: unknown; images: Array<{ size: number; type: string }> }): { ok: true; value: { name: string; note: string | null; maxPriceCents: number | null } } | { ok: false; status: 400 | 413; error: string }`; `parseMaxPriceCents(raw: string): number | null | 'invalid'`; `IStorageService.saveReferenceImage(bytes: Buffer, mimeType: string, referenceKey: string, index: number): Promise<string>`; HTTP: `GET /api/references?k=` → `PhotoReferenceSummary[]`, `POST /api/references?k=` (multipart: `name`, `maxPrice`, `note`, `images[]`) → `{ id, backfill: ReferenceMatchResult }`, `PATCH /api/references/:id?k=` (JSON `{ isActive: boolean }`) → `{ ok: true }`.

- [ ] **Step 1: Failing tests**

```ts
// src/app/api/references/form.test.ts
import { describe, it, expect } from 'vitest'
import { parseMaxPriceCents, parseReferenceForm, MAX_TOTAL_UPLOAD_BYTES } from './form'

const jpeg = (size = 300_000) => ({ size, type: 'image/jpeg' })

describe('parseMaxPriceCents', () => {
  it.each([
    ['150', 15000], ['150 €', 15000], ['150€', 15000], ['1 200', 120000], ['1 200 €', 120000], ['150,50', 15050], ['150.5', 15050],
  ])('parses %s', (raw, cents) => expect(parseMaxPriceCents(raw)).toBe(cents))
  it('is null when blank', () => expect(parseMaxPriceCents('  ')).toBeNull())
  it('flags garbage and non-positive values', () => {
    expect(parseMaxPriceCents('abc')).toBe('invalid')
    expect(parseMaxPriceCents('0')).toBe('invalid')
    expect(parseMaxPriceCents('-5')).toBe('invalid')
  })
})

describe('parseReferenceForm', () => {
  const base = { name: ' Desserte Jansen ', maxPrice: '150 €', note: '', images: [jpeg()] }

  it('accepts a valid form and trims', () => {
    expect(parseReferenceForm(base)).toEqual({ ok: true, value: { name: 'Desserte Jansen', note: null, maxPriceCents: 15000 } })
  })
  it('requires a name', () => {
    expect(parseReferenceForm({ ...base, name: '  ' })).toMatchObject({ ok: false, status: 400 })
  })
  it('requires 1 to 5 images', () => {
    expect(parseReferenceForm({ ...base, images: [] })).toMatchObject({ ok: false, status: 400 })
    expect(parseReferenceForm({ ...base, images: Array.from({ length: 6 }, () => jpeg()) })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects non-image files', () => {
    expect(parseReferenceForm({ ...base, images: [{ size: 10, type: 'application/pdf' }] })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects an unreadable max price with a message', () => {
    expect(parseReferenceForm({ ...base, maxPrice: 'abc' })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('prix') })
  })
  it('answers 413 with a readable message when photos are too heavy', () => {
    const res = parseReferenceForm({ ...base, images: [jpeg(MAX_TOTAL_UPLOAD_BYTES + 1)] })
    expect(res).toMatchObject({ ok: false, status: 413, error: expect.stringContaining('lourdes') })
  })
})
```

```ts
// src/app/api/references/auth.test.ts
import { describe, it, expect } from 'vitest'
import { isReferencesKeyValid } from './auth'

describe('isReferencesKeyValid', () => {
  it('accepts the exact key', () => expect(isReferencesKeyValid('s3cret-key-123456', 's3cret-key-123456')).toBe(true))
  it('rejects a wrong, missing or differently sized key', () => {
    expect(isReferencesKeyValid('wrong-key-1234567', 's3cret-key-123456')).toBe(false)
    expect(isReferencesKeyValid(null, 's3cret-key-123456')).toBe(false)
    expect(isReferencesKeyValid('short', 's3cret-key-123456')).toBe(false)
  })
  it('locks everything when no key is configured', () => {
    expect(isReferencesKeyValid('anything', undefined)).toBe(false)
    expect(isReferencesKeyValid('', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run** `rtk proxy npx vitest --run src/app/api/references` → FAIL.

- [ ] **Step 3: Implement the helpers**

```ts
// src/app/api/references/auth.ts
import { timingSafeEqual } from 'node:crypto'

export function isReferencesKeyValid(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

```ts
// src/app/api/references/form.ts
export const MAX_IMAGES = 5
/** Vercel caps request bodies at 4.5 MB; keep headroom for the multipart envelope. */
export const MAX_TOTAL_UPLOAD_BYTES = 4_000_000

export function parseMaxPriceCents(raw: string): number | null | 'invalid' {
  const compact = raw.replace(/[\s  €]/g, '').replace(',', '.')
  if (compact === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) return 'invalid'
  const cents = Math.round(Number(compact) * 100)
  return cents > 0 ? cents : 'invalid'
}

type FormInput = { name: unknown; maxPrice: unknown; note: unknown; images: Array<{ size: number; type: string }> }
type FormResult =
  | { ok: true; value: { name: string; note: string | null; maxPriceCents: number | null } }
  | { ok: false; status: 400 | 413; error: string }

export function parseReferenceForm(input: FormInput): FormResult {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return { ok: false, status: 400, error: 'Donne un nom à la référence.' }

  if (input.images.length < 1 || input.images.length > MAX_IMAGES) {
    return { ok: false, status: 400, error: `Ajoute entre 1 et ${MAX_IMAGES} photos.` }
  }
  if (input.images.some((i) => !i.type.startsWith('image/'))) {
    return { ok: false, status: 400, error: 'Seules les photos sont acceptées.' }
  }
  if (input.images.reduce((sum, i) => sum + i.size, 0) > MAX_TOTAL_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'Photos trop lourdes : envoie-en moins ou des captures plus petites.' }
  }

  const maxPriceCents = parseMaxPriceCents(typeof input.maxPrice === 'string' ? input.maxPrice : '')
  if (maxPriceCents === 'invalid') return { ok: false, status: 400, error: 'Le prix max doit être un nombre, par ex. 150.' }

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null
  return { ok: true, value: { name, note, maxPriceCents } }
}
```

- [ ] **Step 4: Run** `rtk proxy npx vitest --run src/app/api/references` → PASS.

- [ ] **Step 5: Storage method** — add to `IStorageService`:

```ts
  saveReferenceImage(bytes: Buffer, mimeType: string, referenceKey: string, index: number): Promise<string>
```

and to `CloudinaryStorageService`:

```ts
  async saveReferenceImage(bytes: Buffer, mimeType: string, referenceKey: string, index: number): Promise<string> {
    const folder = `references/${this.sanitizePublicId(referenceKey)}`
    const result = await cloudinary.uploader.upload(`data:${mimeType};base64,${bytes.toString('base64')}`, {
      folder,
      public_id: `${index}`,
      overwrite: false,
      resource_type: 'image',
    })
    return result.secure_url
  }
```

Run `rtk proxy npx tsc --noEmit -p .`; fix any other `IStorageService` implementer or test fake the compiler flags by adding the method (`grep -rn "implements IStorageService" src`).

- [ ] **Step 6: Routes**

```ts
// src/app/api/references/route.ts
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { isReferencesKeyValid } from './auth'
import { parseReferenceForm } from './form'

export const maxDuration = 120

const unauthorized = () => NextResponse.json({ error: 'Lien invalide' }, { status: 401 })

export async function GET(req: NextRequest) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) return unauthorized()
  return NextResponse.json(await container.referenceRepository.list())
}

export async function POST(req: NextRequest) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) return unauthorized()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Envoi illisible, réessaie.' }, { status: 400 })
  }
  const files = form.getAll('images').filter((f): f is File => f instanceof File)
  const parsed = parseReferenceForm({
    name: form.get('name'), maxPrice: form.get('maxPrice'), note: form.get('note'),
    images: files.map((f) => ({ size: f.size, type: f.type })),
  })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  try {
    // Upload first so a Cloudinary failure leaves no half-created reference.
    const uploadKey = randomUUID()
    const imageUrls = await Promise.all(files.map(async (file, index) =>
      container.storageService.saveReferenceImage(Buffer.from(await file.arrayBuffer()), file.type, uploadKey, index)))
    const created = await container.referenceRepository.create(parsed.value, imageUrls)

    // Best-effort: an image left without embedding is retried by the cron stage.
    await Promise.all(created.images.map(async (image) => {
      try {
        await container.referenceRepository.setReferenceImageEmbedding(image.id, await container.imageEmbeddingService.embedImage(image.url))
      } catch (err) {
        console.error(`Reference image embedding failed for ${image.id}:`, err)
      }
    }))

    let backfill = null
    try {
      backfill = await container.runReferenceMatchUseCase.backfill(created.id)
    } catch (err) {
      console.error(`Reference backfill failed for ${created.id}:`, err)
    }
    return NextResponse.json({ id: created.id, backfill })
  } catch (err) {
    console.error('Reference creation failed:', err)
    return NextResponse.json({ error: "L'enregistrement a échoué, réessaie dans un instant." }, { status: 500 })
  }
}
```

```ts
// src/app/api/references/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { isReferencesKeyValid } from '../auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 401 })
  }
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { isActive?: unknown } | null
  if (typeof body?.isActive !== 'boolean') return NextResponse.json({ error: 'isActive manquant' }, { status: 400 })
  await container.referenceRepository.setActive(id, body.isActive)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: Middleware** — in `src/middleware.ts` change `ALLOWED_PATHS` to:

```ts
const ALLOWED_PATHS = ['/feedback', '/api/feedback', '/api/references', '/api/cron']
```

- [ ] **Step 8: Verify** — `rtk proxy npx tsc --noEmit -p .` and `rtk proxy npx vitest --run` → green.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/references src/infrastructure/storage src/middleware.ts
git commit -m "feat(references): key-protected API to upload and manage references"
```

---

### Task 9: Mobile references page, then ship

**Files:**
- Create: `src/app/feedback/references/resize-image.ts`
- Create: `src/app/feedback/references/page.tsx`

**Interfaces:**
- Consumes: the HTTP API from Task 8; `PhotoReferenceSummary` shape (Task 2) as JSON (`createdAt` is a string).
- Produces: the page at `/feedback/references?k=…`.

- [ ] **Step 1: Client-side resize** (browser-only, not unit-tested; covered by the manual check in Step 4)

```ts
// src/app/feedback/references/resize-image.ts
const MAX_SIDE = 1600
const QUALITY = 0.85

/**
 * Phone photos are 3-8 MB; Vercel rejects request bodies above 4.5 MB. Re-encode
 * to a ≤1600px JPEG (~200-400 KB) before upload. Falls back to the original file
 * when the browser cannot decode it.
 */
export async function resizeImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    return blob ?? file
  } catch {
    return file
  }
}
```

- [ ] **Step 2: Page**

```tsx
// src/app/feedback/references/page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { resizeImage } from './resize-image'

type Reference = {
  id: string; name: string; note: string | null; maxPriceCents: number | null; isActive: boolean
  imageUrls: string[]; matchCount: number; matchedListingUrls: string[]
}

function ReferencesContent() {
  const key = useSearchParams().get('k') ?? ''
  const [references, setReferences] = useState<Reference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`)
    if (!res.ok) { setError('Lien invalide : utilise le bouton « Ajouter des références » d’un mail du bot.'); return }
    setReferences(await res.json())
  }, [key])

  useEffect(() => { void load() }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMessage(null); setError(null)
    try {
      const body = new FormData()
      body.set('name', name); body.set('maxPrice', maxPrice); body.set('note', note)
      for (const [i, file] of files.entries()) body.append('images', await resizeImage(file), `photo-${i}.jpg`)
      const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Erreur, réessaie.'); return }
      const found = json.backfill?.confirmed ?? 0
      setMessage(found > 0
        ? `Référence ajoutée. ${found} annonce${found > 1 ? 's' : ''} des 7 derniers jours lui ressemble${found > 1 ? 'nt' : ''} : regarde tes mails !`
        : 'Référence ajoutée. Je te préviens dès qu’une annonce lui ressemble.')
      setFiles([]); setName(''); setMaxPrice(''); setNote('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggle(ref: Reference) {
    await fetch(`/api/references/${ref.id}?k=${encodeURIComponent(key)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isActive: !ref.isActive }),
    })
    await load()
  }

  if (error && !references) return <p style={{ padding: 16 }}>{error}</p>

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 16, fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>📸 Mes références</h1>
      <p style={{ color: '#666', fontSize: 14 }}>
        Ajoute des photos d’une pièce que tu cherches : dès qu’une annonce montre la même, tu reçois un mail.
        Le bot ne voit que les annonces de ses recherches, entre 50 et 400 €.
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 10, margin: '16px 0 28px' }}>
        <input type="file" accept="image/*" multiple required
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
        {files.length > 0 && <small>{files.length} photo{files.length > 1 ? 's' : ''} (5 max)</small>}
        <input placeholder="Nom (ex. desserte Jansen laiton)" value={name} onChange={(e) => setName(e.target.value)} required
          style={{ padding: 10, fontSize: 16 }} />
        <input placeholder="Prix max (optionnel, ex. 150)" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
          style={{ padding: 10, fontSize: 16 }} />
        <textarea placeholder="Note (optionnel : détails qui comptent)" value={note} onChange={(e) => setNote(e.target.value)}
          style={{ padding: 10, fontSize: 16, minHeight: 70 }} />
        <button type="submit" disabled={saving}
          style={{ padding: 14, fontSize: 16, fontWeight: 'bold', background: '#ff6b00', color: 'white', border: 0, borderRadius: 8 }}>
          {saving ? 'Envoi…' : 'Ajouter la référence'}
        </button>
        {message && <p style={{ color: '#16a34a' }}>{message}</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      </form>

      {references?.map((ref) => (
        <div key={ref.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid #eee', opacity: ref.isActive ? 1 : 0.5 }}>
          {ref.imageUrls[0] && <img src={ref.imageUrls[0]} alt={ref.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{ref.name}</strong>
            <div style={{ fontSize: 13, color: '#666' }}>
              {ref.maxPriceCents !== null ? `max ${ref.maxPriceCents / 100} € · ` : ''}
              {ref.matchCount} trouvaille{ref.matchCount > 1 ? 's' : ''}
            </div>
            {ref.matchedListingUrls.slice(0, 3).map((url) => (
              <a key={url} href={url} style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{url}</a>
            ))}
          </div>
          <button onClick={() => toggle(ref)} style={{ alignSelf: 'center', padding: '8px 10px' }}>
            {ref.isActive ? 'Pause' : 'Reprendre'}
          </button>
        </div>
      ))}
    </main>
  )
}

export default function ReferencesPage() {
  return (
    <Suspense fallback={<p style={{ padding: 16 }}>Chargement…</p>}>
      <ReferencesContent />
    </Suspense>
  )
}
```

- [ ] **Step 3: Verify build-level checks** — `rtk proxy npx tsc --noEmit -p .`, `rtk proxy npx vitest --run`, `rtk proxy npx next lint` → clean. Commit:

```bash
git add src/app/feedback/references
git commit -m "feat(references): mobile page to add and pause references"
```

- [ ] **Step 4: Ship and verify in production** (needs the user for the env var and the phone check)

1. Ask the user to set `REFERENCES_KEY` (≥16 random chars, e.g. `openssl rand -hex 16`) in Vercel Production env vars.
2. `git push` (deploys and applies the migration).
3. SQL checks (Supabase MCP `execute_sql`):
   - `SELECT count(*) FROM photo_references;` → 0, table exists.
   - `SELECT count(*) FILTER (WHERE "referenceCheckedAt" IS NULL) FROM lbc_product_listings;` → roughly the last 7 days of ads.
4. Open `/feedback/references?k=<key>` on a phone, add one real reference (a piece known to be on LBC this week). Expect the success message; `SELECT * FROM reference_matches ORDER BY "createdAt" DESC LIMIT 20;` shows judged pairs with similarities.
5. Next cron run: Vercel logs for `analyze-and-notify` show the `references` stage result and no failed stages.
6. Without the key, `GET /api/references` → 401.

---

## Self-review notes

- Spec coverage: data model (T2), upload page + key + retry (T8, T9, T5), matching stage + backfill (T5, T6), alert email (T5), always-at-hand button (T7), tests (T1, T3, T5, T7, T8), rollout (T9). Table renamed to `photo_references` per the spec update.
- Deliberate deviation: the spec mentions skipping references "whose `maxPriceCents` is below the ad price" in the pgvector step; the plan applies it in the use case (`judge`) so it is unit-tested, with the same effect.
