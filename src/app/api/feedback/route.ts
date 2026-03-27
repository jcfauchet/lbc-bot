import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infrastructure/prisma/client'
import { ListingFeedback } from '@/domain/entities/ListingFeedback'
import { PrismaFeedbackRepository } from '@/infrastructure/prisma/repositories/PrismaFeedbackRepository'
import { EmbeddingService } from '@/infrastructure/ai/EmbeddingService'
import { env } from '@/infrastructure/config/env'

// POST /api/feedback — save a feedback with optional comment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { listingId, vote, comment } = body as {
      listingId: string
      vote: 'good' | 'bad'
      comment?: string
    }

    if (!listingId || !vote) {
      return NextResponse.json({ error: 'Missing listingId or vote' }, { status: 400 })
    }

    const listing = await prisma.lbcProductListing.findUnique({
      where: { id: listingId },
      include: { aiAnalysis: true },
    })

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    }

    const repo = new PrismaFeedbackRepository(prisma)

    // Check if feedback already exists
    const existing = await repo.findByListingId(listingId)
    if (existing) {
      // Just update comment if provided
      if (comment) {
        await repo.updateComment(existing.id, comment)
      }
      return NextResponse.json({ ok: true, id: existing.id })
    }

    // Build text to embed: title + AI description
    const aiDescription = listing.aiAnalysis?.description ?? ''
    const embeddingText = `${listing.title}. ${aiDescription}`.trim()

    const embeddingService = new EmbeddingService(env.OPENAI_API_KEY)
    const embedding = await embeddingService.embed(embeddingText)

    const feedback = ListingFeedback.create({
      listingId,
      isGood: vote === 'good',
      comment,
      embeddingText,
    })

    await repo.save(feedback, embedding)

    return NextResponse.json({ ok: true, id: feedback.id })
  } catch (error) {
    console.error('Feedback API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/feedback — add/update comment on existing feedback
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, comment } = body as { id: string; comment: string }

    if (!id || !comment) {
      return NextResponse.json({ error: 'Missing id or comment' }, { status: 400 })
    }

    const repo = new PrismaFeedbackRepository(prisma)
    await repo.updateComment(id, comment)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Feedback PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
