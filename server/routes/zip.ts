import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import archiver from 'archiver';
import { z } from 'zod';

const zipRequestSchema = z.object({
  archiveName: z.string().optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1, '缺少檔名'),
        data: z.string().min(1, '缺少檔案內容'),
        mimeType: z.string().optional()
      })
    )
    .max(150, '一次最多 150 個檔案')
});

type ZipRequest = z.infer<typeof zipRequestSchema>;

function decodeData(data: string) {
  if (data.startsWith('data:')) {
    const [meta, base64] = data.split(',');
    const mimeMatch = /^data:(.*?);base64$/i.exec(meta);
    const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
    return {
      buffer: Buffer.from(base64, 'base64'),
      mimeType
    };
  }

  return {
    buffer: Buffer.from(data, 'base64'),
    mimeType: 'application/octet-stream'
  };
}

const zipRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/zip', async (request, reply) => {
    let payload: ZipRequest;

    try {
      payload = zipRequestSchema.parse(request.body);
    } catch (error) {
      reply.status(400);
      return {
        error: 'invalid_payload',
        message: error instanceof Error ? error.message : 'Invalid request body'
      };
    }

    if (payload.files.length > fastify.config.maxFiles) {
      reply.status(400);
      return {
        error: 'too_many_files',
        message: `一次最多 ${fastify.config.maxFiles} 個檔案`
      };
    }

    const archiveName = payload.archiveName || 'avatars.zip';

    reply.header('Content-Type', 'application/zip');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${archiveName.replace(/"/g, '')}"`
    );

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (error) => {
      fastify.log.error({ err: error }, 'Zip stream failed');
      reply.raw.destroy(error);
    });

    reply.send(archive);

    for (const file of payload.files) {
      const { buffer, mimeType } = decodeData(file.data);
      archive.append(buffer, {
        name: file.name,
        date: new Date(),
        comment: mimeType
      });
    }

    await archive.finalize();
  });
};

export default fp(zipRoute);
