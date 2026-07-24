import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        // Pure re-export barrel — counting it only inflates the totals.
        'src/index.ts',
      ],
      thresholds: {
        // Global floors, set just under the measured numbers so the suite guards
        // against regression without blocking work. Raise them as coverage
        // improves; do not lower them to make a red build pass.
        //
        // Measure with `npm run test:coverage`. The tests run entirely against
        // temp dirs and the `HYBINDEX_CACHE_DIR` override, so local and CI
        // numbers match — there is no real-asset skip case to reproduce.
        //
        // Baseline on this commit: statements 87.47, branches 66.74,
        // functions 91.02, lines 89.98.
        lines: 89,
        branches: 65,
        functions: 90,
        statements: 86,
      },
    },
  },
});
