import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/prisma/client';
import { container } from '@/infrastructure/di/container';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for scraping

export async function GET(request: Request) {
  try {
    // Verify authorization (cron secret from Vercel)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[CRON] Starting scrapers...');
    const useCase = container.runReferenceScrapersUseCase;
    await useCase.execute();

    return NextResponse.json({ 
      success: true, 
      message: 'Scrapers executed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[CRON] Error running scrapers:', error);
    return NextResponse.json({ 
      error: 'Failed to run scrapers',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
