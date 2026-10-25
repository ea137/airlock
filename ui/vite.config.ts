import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Two builds from one source: the phone UI (the default), which the hub
// embeds from dist/, and the laptop app's window (`--mode laptop`), which the
// Tauri app embeds from dist-laptop/.
export default defineConfig(({ mode }) => {
  const laptop = mode === 'laptop';
  return {
    plugins: [svelte()],
    // Relative URLs, so the UI works under whatever path Tailscale Serve mounts.
    base: './',
    // The phone's service worker, web app manifest and icons; the laptop
    // app has no use for them.
    publicDir: laptop ? false : 'public',
    build: {
      outDir: laptop ? 'dist-laptop' : 'dist',
      emptyOutDir: true,
      // Fonts and images stay files: the CSPs serve them from 'self'.
      assetsInlineLimit: 0,
      rolldownOptions: { input: laptop ? 'laptop.html' : 'index.html' },
    },
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
