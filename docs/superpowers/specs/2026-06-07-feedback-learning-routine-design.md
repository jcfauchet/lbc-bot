# Daily feedback-learning routine — design

## Problem

Users give feedback on notified listings (👍/👎 + free-text comment), stored in
`listing_feedbacks` with pgvector embeddings. After the funnel was refactored to
the Lens pipeline, **this feedback is no longer consumed anywhere** — it is
write-only. Current data: 21 feedbacks, all negative, 18 with comments. The
signal ("why this listing should not have been notified") is wasted.

## Goal

A daily routine that reads the negative feedback and integrates it back into the
funnel to **reduce false positives**, without manual tuning.

## Chosen approach (A): distil feedback into triage guidance

Each day, an LLM reads the negative feedback (title + AI description + comment)
and distils it into a compact set of "avoid" rules. Those rules are stored,
versioned, and injected into the triage prompt. The triage LLM keeps scoring
0–10 against the unchanged `TRIAGE_MIN_SCORE` threshold — the rules only inform
its judgement. Guidance is advisory, never a hard filter, so a bad rule can
nudge but cannot wipe out the funnel.

Rejected alternatives:
- **Similarity suppression (embeddings):** too noisy with ~21 all-negative
  examples; revisit once data grows.
- **Digest only:** informs the human, does not improve the bot autonomously.

## Components

Each unit has one purpose, a defined interface, and is testable in isolation.

1. **`triage_guidance` table** (Prisma model `TriageGuidance`)
   - `id`, `content` (Text), `sourceFeedbackCount` (Int), `createdAt`.
   - Append-only → versioned history; rollback = delete latest row.

2. **`ITriageGuidanceRepository`**
   - `getLatest(): Promise<TriageGuidance | null>`
   - `save(content: string, sourceFeedbackCount: number): Promise<TriageGuidance>`
   - Prisma implementation.

3. **`IFeedbackRepository.findRecentNegative(limit: number)`** (new method)
   - Returns negative feedbacks with `listingTitle`, `comment`, `aiDescription`.

4. **`IFeedbackLearningService.distil(feedbacks): Promise<string>`**
   - Implementation `GeminiFeedbackLearningService` (text-only, cheap).
   - Prompt constraints: max 15 short rules, generalise, keep only recurring
     patterns, output plain bullet lines.

5. **`RunFeedbackLearningUseCase`**
   - Reads negative feedback → if count unchanged since last guidance, **skip**
     (idempotent, saves LLM cost) → otherwise distil → save guidance.
   - Returns `{ skipped: boolean; rulesGenerated: number; sourceFeedbackCount: number }`.

6. **`buildTriagePrompt(guidance?: string)`** in `triage-prompt.ts`
   - Returns the base prompt, with an "Past mistakes to avoid:" section appended
     when guidance is present (length-capped on injection).
   - `ITriageService.triage(imageUrl, title, guidance?)` gains the optional arg;
     Gemini + OpenAI implementations append it.

7. **`RunTriageUseCase`**
   - Loads latest guidance once at start, passes it to each `triage()` call.

8. **Cron route `/api/cron/learn-feedback`**
   - `maxDuration = 60`, `CRON_SECRET` auth (same pattern as other crons).
   - `vercel.json`: `{ "path": "/api/cron/learn-feedback", "schedule": "0 3 * * *" }`.

## Data flow

```
03:00 daily  → /api/cron/learn-feedback
             → RunFeedbackLearningUseCase
               → IFeedbackRepository.findRecentNegative
               → (skip if count unchanged)
               → IFeedbackLearningService.distil → rules text
               → ITriageGuidanceRepository.save

every 15 min → RunTriageUseCase
             → ITriageGuidanceRepository.getLatest
             → buildTriagePrompt(guidance) → triage(imageUrl, title, guidance)
```

## Guardrails against over-filtering

- Guidance is advisory; `TRIAGE_MIN_SCORE` unchanged → rules cannot zero the funnel.
- Output bounded (≤15 rules; capped length when injected into the prompt).
- Versioned table → revert by deleting the latest row; triage falls back to the
  previous version.

## Out of scope (YAGNI)

- Embedding-similarity suppression (option B).
- Backfilling the 2 missing feedback embeddings.
- Using positive feedback (none exists yet).

## Testing

- `RunFeedbackLearningUseCase`: distils on new feedback; skips when count
  unchanged; passes feedback payload to the service.
- `buildTriagePrompt`: injects guidance; works without it.
- `RunTriageUseCase`: loads and forwards guidance (extend existing test).

## Error handling

- Distillation failure (LLM error): log and leave the previous guidance in place;
  the cron returns success with `skipped` semantics so it does not retry-storm.
- No feedback yet: skip cleanly, no guidance row written.
