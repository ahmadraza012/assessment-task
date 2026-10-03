import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'src/callEngine.d.ts'),
    },
  },
});
