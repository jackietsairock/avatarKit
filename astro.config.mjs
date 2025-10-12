import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

const apiPort =
  Number.parseInt(process.env.API_PORT || process.env.PORT || '', 10) || 4001;
const maxFiles =
  Number.parseInt(process.env.PUBLIC_MAX_FILES || process.env.API_MAX_FILES || '', 10) ||
  50;

export default defineConfig({
  output: 'hybrid',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    react(),
    tailwind({
      applyBaseStyles: true
    })
  ],
  server: {
    host: true,
    port: 3000
  },
  vite: {
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true
        }
      }
    },
    define: {
      __AVATAR_MAX_FILES__: JSON.stringify(maxFiles)
    }
  }
});
