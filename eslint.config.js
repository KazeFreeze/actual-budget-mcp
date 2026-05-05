import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import nodePlugin from 'eslint-plugin-n';
import securityPlugin from 'eslint-plugin-security';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  nodePlugin.configs['flat/recommended-module'],
  securityPlugin.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce no unsafe any usage
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // Enforce explicit return types on exported functions
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],

      // Enforce exhaustive switch/if checks
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // No floating promises
      '@typescript-eslint/no-floating-promises': 'error',

      // Prefer nullish coalescing
      '@typescript-eslint/prefer-nullish-coalescing': 'error',

      // Allow void for fire-and-forget
      '@typescript-eslint/no-confusing-void-expression': ['error', {
        ignoreArrowShorthand: true,
      }],

      // Relax for MCP handler patterns
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: true,
      }],

      // Unused vars — allow underscore prefix
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // TS resolver handles module resolution (incl. subpath exports like MCP SDK); n's Node resolver misreads these
      'n/no-missing-import': 'off',

      // tsc preserves src shebang to build/src/index.js (the actual bin); n only sees the .ts source
      'n/hashbang': 'off',

      // Legitimate for CLI/server entrypoints (fatal-config, signal-handler exits)
      'n/no-process-exit': 'off',

      // Noisy false positives on legitimate bracket access; type-aware TS rules catch real unsafe dynamic access
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Tests may import devDependencies (vitest, msw)
    files: ['tests/**/*.ts'],
    rules: {
      'n/no-unpublished-import': 'off',
    },
  },
  {
    ignores: ['build/**', 'node_modules/**', 'eslint.config.js', 'vitest.config.ts', 'vitest.integration.config.ts', 'commitlint.config.js'],
  },
);
