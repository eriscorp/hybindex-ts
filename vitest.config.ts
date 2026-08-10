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
        // Measure with `npm run test:coverage`. Neither platform is uniformly
        // the lower one, so the floors take the minimum of the two. Windows runs
        // the `win32` arm of `resolveCacheBase` and reports higher function
        // coverage; Linux runs the POSIX vendor-directory rename in storage.ts,
        // which cannot execute on a case-insensitive filesystem, and reports
        // higher line and statement coverage.
        //
        // Baseline at 1.1.0 — Linux (CI): statements 89.78, branches 74.41,
        // functions 91.30, lines 92.00. Windows: 88.34, 74.17, 92.39, 90.00.
        lines: 89,
        branches: 73,
        functions: 90,
        statements: 88,
      },
    },
  },
});
