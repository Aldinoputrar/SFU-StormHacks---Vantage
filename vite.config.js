import { defineConfig } from 'vite';

// Word checks go to Merriam-Webster's Scrabble dictionary. Browsers block
// pages from reading another site directly, so /mw/* is relayed by Vite's
// dev and preview servers (and by vercel.json or public/_redirects when
// deployed).
const merriamWebster = {
  '/mw': {
    target: 'https://scrabble.merriam.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/mw/, ''),
  },
};

export default defineConfig({
  server: { proxy: merriamWebster },
  preview: { proxy: merriamWebster },
});
