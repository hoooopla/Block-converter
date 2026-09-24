import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'serve-texlive-glue',
    configureServer(server) {
      // The TeX worker imports its Emscripten glue by URL. Vite adds ?import
      // to variable imports in development, which otherwise makes it try to
      // transform a file from public/ and reject it.
      server.middlewares.use((request, _response, next) => {
        if (request.url?.includes('/texlive-wasm/') && request.url.includes('.js?import')) {
          request.url = request.url.replace(/\?import(?:&.*)?$/, '');
        }
        next();
      });
    },
  }],
  // The package resolves its Worker relative to import.meta.url; dependency
  // prebundling moves that module without moving the Worker beside it.
  optimizeDeps: { exclude: ['@typeward/texlive-wasm'] },
  base: '/Block-converter/'
});
