import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

const apiPort =
  Number.parseInt(process.env.API_PORT || process.env.PORT || '', 10) || 4001;

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
      __REMOVE_BG_MAX_FILES__: JSON.stringify(
        Number(process.env.REMOVE_BG_MAX_FILES || 50)
      )
    }
  }
});
