import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', 'package-lock.json'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['frontend/**/*.tsx', 'frontend/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['datasets/**/*.js', 'bench/**/*.mjs', '*.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
  },
  prettier
);
