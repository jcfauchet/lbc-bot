// setupTests.ts
import dotenv from 'dotenv';
// Same precedence as Next.js: .env.local wins over .env (dotenv never overrides already-set vars).
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
