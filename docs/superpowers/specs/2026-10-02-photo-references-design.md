# Photo references ("if you ever see this, don't miss it") — design

**Date:** 2026-10-02
**Context:** The reseller who votes on deals asked to upload photos of pieces she
wants the bot to spot. Today she can only correct what the bot shows her; she has
no way to teach it about pieces it never surfaced.

## Goal

She uploads 1-5 photos of a piece (an exact model first, e.g. a Maison Jansen brass
trolley). Whenever a scraped Leboncoin ad shows the same piece at or below her max
price, she gets an immediate dedicated email — regardless of the triage score or
the comp estimate.

Success: a reference she adds triggers an alert on a matching ad within one funnel
run of the ad being scraped, with few enough false alerts that she keeps trusting
the email.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| What a reference means | The exact object/model first. Style-level guidance stays the job of votes + learned triage guidance. |
| What a match does | Immediate dedicated alert, bypassing triage score, comp budget and margin gates. Optional max price per reference. |
| How she adds one | Photo upload from her phone (screenshots welcome). No URL import (YAGNI). |
| Matching technique | Two passes: Gemini Embedding 2 image vectors (pgvector) to shortlist, then Gemini vision confirms "same model or not". |

## Non-goals

- Importing a reference from a URL.
- Style-level ("this kind of thing") matching beyond what the embedding naturally gives.
- Widening what the scraper collects: matching only sees ads from the configured
  searches within the global price bounds (50-400€).
- User accounts / proper auth.

## Data model

New tables (Prisma models, one migration):

- `photo_references` (`references` is a reserved SQL word) — `id`, `name`, `maxPriceCents Int?`, `note Text?`,
  `isActive Boolean @default(true)`, `createdAt`.
- `reference_images` — `id`, `referenceId` (cascade delete), `urlRemote` (Cloudinary),
  `embedding vector(768)` nullable, `createdAt`.
- `reference_matches` — `id`, `referenceId`, `listingId` (both cascade delete),
  `similarity Float`, `confirmed Boolean`, `reason Text?`, `notifiedAt DateTime?`,
  `createdAt`; unique on (`referenceId`, `listingId`) so a pair is judged and
  alerted at most once.

Changes to existing tables:

- `listing_images.embedding vector(768)` nullable — the listing photo fingerprint,
  stored so a new reference can be checked against recent ads without re-embedding.
- `lbc_product_listings.referenceCheckedAt DateTime?` — the matching stage's own
  progress marker, independent of `status`, so ads the prefilter or triage ignore
  are still compared.

Vectors are 768-dim (Gemini Embedding 2 supports 128-3072) to keep storage and
index cost low; cosine distance, same `<=>` operator as `listing_feedbacks`.

## Upload page

`/feedback/references` (already reachable in production via the `/feedback`
allow-list in `middleware.ts`), mobile-first:

- Form: 1-5 photos (gallery or camera), name (required), max price (optional),
  note (optional). A reminder that the bot only sees ads from its configured searches.
- List of references: thumbnail, name, max price, pause/resume, match count with
  links to matched ads.

`POST /api/references` (multipart) uploads the photos to Cloudinary, embeds each one,
saves the reference, then runs the 7-day backfill (below). `PATCH /api/references/:id`
toggles `isActive`.

**Access:** both the page and the API require `?k=<REFERENCES_KEY>` (new env var);
the page forwards it to the API. The vote pages stay as they are. An embedding
failure does not fail the upload: the image is saved with a NULL embedding and the
matching stage embeds it on its next run.

**Link always at hand:** the good-deals digest email and the 🎯 alert email carry
an "Ajouter des références" button pointing to `/feedback/references?k=<REFERENCES_KEY>`,
next to the existing "Noter toutes les annonces" button. Hidden when the key is unset.
The key travels in emails sent only to `NOTIFICATION_EMAIL_TO`, which is acceptable
for a two-person tool.

## Matching stage

New `RunReferenceMatchUseCase`, run as the **first** stage of the
`analyze-and-notify` cron through the existing `runStage` isolation (a throw never
blocks prefilter/triage/comp/notify). It does nothing when there are no active
references.

Per run:

1. Embed any `reference_images` with a NULL embedding (retry path).
2. Take listings with `referenceCheckedAt IS NULL`, newest first, capped per run
   (`REFERENCE_MATCH_MAX_PER_RUN`, default 60; ~500 ads/day over 96 runs fits easily).
3. For each listing, isolated in its own try/catch:
   - Embed its first 3 images (missing embeddings only), store on `listing_images`.
   - pgvector query: best cosine similarity per active reference across
     listing photos × reference photos.
   - Skip references already judged for this listing, references whose
     `maxPriceCents` is below the ad price, and listings the user voted down.
   - For each reference with similarity ≥ `REFERENCE_MATCH_MIN_SIMILARITY`
     (default 0.75, deliberately loose, to calibrate on real references): ask Gemini
     vision with the ad photos, the reference photos, the reference name and note:
     "is this the same model/design?" → strict JSON `{"same": bool, "reason": string}`.
   - Record a `reference_matches` row (confirmed or not — a rejected pair is not
     re-asked).
   - Set `referenceCheckedAt`. On failure: log, leave the marker NULL so the next
     run retries, continue with the next listing.

**Backfill on creation:** when a reference is created, the same compare-and-confirm
runs against listings scraped in the last 7 days whose images already carry an
embedding. Pure DB query plus a few confirmation calls; no re-embedding.

Interfaces (domain), with Gemini adapters in `infrastructure/ai/Gemini`:

- `IImageEmbeddingService.embedImage(url): Promise<number[]>` — `gemini-embedding-2-preview`,
  768 dimensions, called through the REST `embedContent` endpoint: the installed
  `@google/genai` 1.30 only embeds text parts, and 2.x is a major bump.
- `IReferenceMatchVerifier.verify(listingImageUrls, referenceImageUrls, name, note)`
  → `{ same, reason }` — `gemini-3.6-flash`, same parse-tolerant style as triage.
- `IReferenceRepository` — CRUD, candidate similarity query, match recording,
  pending-alert query.

## Alert email

Sent by the same stage right after matching, for confirmed matches with
`notifiedAt IS NULL`:

- One email per match. Subject: `🎯 Ressemble à ta référence : <name>`.
- Body: ad photo and reference photo side by side, ad title, price, city, link to
  the ad, Gemini's one-line reason, and the existing 👍/👎 feedback links so the
  match also feeds the learning loop.
- `notifiedAt` is set only after Resend accepts the send; a failed send is retried
  next run.
- Uses the existing `IMailer` / `EmailTemplates`; independent of the comp budget and
  of the `RunNotificationUseCase` margin gates.

French copy is user-facing content inside the email template, consistent with the
existing templates.

## Testing

- Use case unit tests with fakes (Vitest, same style as `RunCompAnalysisUseCase.test.ts`):
  no active references → no work; similarity below threshold → no verifier call;
  above threshold + verifier "same" → confirmed match + one email; verifier "not
  same" → recorded, no email, not re-asked; ad price above max price → skipped;
  one listing throwing → others still processed and its marker stays NULL;
  already-notified match → no second email; failed send → `notifiedAt` stays NULL.
- Verifier response parsing tests (malformed JSON, missing fields → `same: false`).
- API route test: missing or wrong `k` → 401.
- Manual check after deploy: add one real reference, confirm the 7-day backfill
  and logged similarities, then tune `REFERENCE_MATCH_MIN_SIMILARITY` from the
  observed distribution.

## Rollout

1. Migration + `REFERENCES_KEY` env var in Vercel.
2. Deploy; the stage is a no-op until a reference exists.
3. Share the bookmarked link `/feedback/references?k=…` with her.
4. After a week: look at `reference_matches` (similarity distribution, confirmed
   vs rejected, her votes on alerts) and adjust the threshold.
