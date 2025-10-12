import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { loadConfig } from '../utils/config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: ReturnType<typeof loadConfig>;
  }
}

const configPlugin: FastifyPluginAsync = async (fastify) => {
  const config = loadConfig();

  if (!config.removeBgApiKey) {
    fastify.log.warn(
      'REMOVE_BG_API_KEY is not set. /api/remove-bg will reject requests.'
    );
  }

  fastify.decorate('config', config);
};

export default fp(configPlugin);
