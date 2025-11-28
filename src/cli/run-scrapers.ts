import 'dotenv/config';
import { prisma } from '@/infrastructure/prisma/client';
import { RunReferenceScrapersUseCase } from '@/application/use-cases/RunReferenceScrapersUseCase';
import { container } from '@/infrastructure/di/container';

async function main() {
  console.log('Running scrapers job...');
  const useCase = container.runReferenceScrapersUseCase;
  await useCase.execute();
  console.log('Job completed.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
