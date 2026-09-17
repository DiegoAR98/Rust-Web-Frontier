import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Closes a lost-`session`-message race between connectTo and
    // waitForMessage that fails a random integration file under load.
    setupFiles: ['tests/setup.ts'],
  },
});
