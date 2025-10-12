import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import removeBgRoute from './removeBg.js';
import zipRoute from './zip.js';

const routes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(removeBgRoute);
  await fastify.register(zipRoute);
};

export default fp(routes);
