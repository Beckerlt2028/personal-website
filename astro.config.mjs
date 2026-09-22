// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Private pages allow scripts from self, never inline executable scripts.
  vite: { build: { assetsInlineLimit: 0 } },
});
