import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import configPlugin from './plugins/config.js';
import routes from './routes/index.js';

async function buildServer() {
  const fastify = Fastify({
    logger: true,
    bodyLimit: Number.parseInt(process.env.API_BODY_LIMIT || '', 10) || 40 * 1024 * 1024
  });

  await fastify.register(cors, {
    origin: true,
    methods: ['POST', 'GET', 'OPTIONS']
  });

  await fastify.register(configPlugin);
  await fastify.register(routes);

  fastify.get('/healthz', async () => ({ status: 'ok' }));

  return fastify;
}

async function start() {
  const server = await buildServer();
  const port =
    Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '', 10) ||
    4001;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export default buildServer;
