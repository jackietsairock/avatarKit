import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { FormData } from 'undici';
import { z } from 'zod';
import { imageSize } from 'image-size';

const removeBgRequestSchema = z
  .object({
    image: z.string().optional(),
    imageUrl: z.string().url().optional(),
    size: z
      .enum(['auto', 'preview', 'full', 'hd', '4k'])
      .default('auto'),
    bg: z.enum(['transparent', 'white', 'black']).default('transparent'),
    format: z.enum(['png', 'webp']).default('png'),
    keepSize: z.boolean().optional(),
    name: z.string().optional()
  })
  .refine((payload) => payload.image || payload.imageUrl, {
    message: 'image 或 imageUrl 至少需要一個',
    path: ['image']
  });

type RemoveBgRequest = z.infer<typeof removeBgRequestSchema>;

function normalizeBase64(input: string) {
  const base64 = input.includes(',')
    ? input.slice(input.indexOf(',') + 1)
    : input;
  return base64.replace(/\s/g, '');
}

const removeBgRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/remove-bg',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' }
      }
    },
    async (request, reply) => {
      if (!fastify.config.removeBgApiKey) {
        reply.status(501);
        return {
          error: 'remove_bg_not_configured',
          message: '後端尚未設定 remove.bg API key'
        };
      }

      let payload: RemoveBgRequest;

      try {
        payload = removeBgRequestSchema.parse(request.body);
      } catch (error) {
        reply.status(400);
        return {
          error: 'invalid_payload',
          message: error instanceof Error ? error.message : 'Invalid request body'
        };
      }

      const formData = new FormData();
      formData.set('size', payload.size);
      formData.set('format', payload.format);
      formData.set('bg', payload.bg);

      if (payload.keepSize) {
        formData.set('channels', 'rgba');
        formData.set('crop', 'false');
        formData.set('type_level', 'latest');
      }

      if (payload.image) {
        formData.set('image_file_b64', normalizeBase64(payload.image));
      } else if (payload.imageUrl) {
        formData.set('image_url', payload.imageUrl);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fastify.config.removeBgTimeoutMs);

      try {
        const response = await fetch(fastify.config.removeBgApiUrl, {
          method: 'POST',
          headers: {
            'X-Api-Key': fastify.config.removeBgApiKey
          },
          body: formData,
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const errorJson = await response.json();
            fastify.log.error({ errorJson }, 'remove.bg API failed');
            reply.status(response.status);
            return {
              error: 'remove_bg_failed',
              message: errorJson?.errors?.[0]?.title || 'remove.bg API error',
              details: errorJson
            };
          }
          const errorText = await response.text();
          fastify.log.error({ errorText }, 'remove.bg API failed');
          reply.status(response.status);
          return {
            error: 'remove_bg_failed',
            message: errorText
          };
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const dimensions = imageSize(buffer);

        const dataUrl = `data:image/${payload.format};base64,${buffer.toString(
          'base64'
        )}`;

        return {
          name: payload.name,
          dataUrl,
          width: dimensions.width || null,
          height: dimensions.height || null
        };
      } catch (error) {
        clearTimeout(timeout);

        if (error instanceof Error && error.name === 'AbortError') {
          reply.status(504);
          return {
            error: 'remove_bg_timeout',
            message: 'remove.bg API 逾時，請稍後再試'
          };
        }

        fastify.log.error({ err: error }, 'remove.bg API exception');
        reply.status(500);
        return {
          error: 'remove_bg_exception',
          message: error instanceof Error ? error.message : '未知錯誤'
        };
      }
    }
  );
};

export default fp(removeBgRoute);
