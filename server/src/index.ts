import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { createPrismaGameRepository } from './repo/prismaGameRepository.js';
import { GameService } from './services/gameService.js';

const prisma = new PrismaClient();
const service = new GameService(createPrismaGameRepository(prisma));
const app = createApp(service);

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  console.log(`Fantasy Pickup API listening on http://localhost:${port}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
