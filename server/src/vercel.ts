// Entry point for Vercel: the same Express app, exported instead of listening on a port.
// api/index.js re-exports it as a Vercel Function. Local dev still uses src/index.ts.
import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { createPrismaGameRepository } from './repo/prismaGameRepository.js';
import { GameService } from './services/gameService.js';

// One client per function instance (instances are reused between requests).
const prisma = new PrismaClient();

export default createApp(new GameService(createPrismaGameRepository(prisma)));
