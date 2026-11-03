import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', 'src-tauri/**', '.tmp/**']),
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/await-thenable': 'error',
      // Callback DOM/Tauri boleh async; Promise dalam kondisi/spread tetap diperiksa.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      'no-promise-executor-return': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    // Mock DOM/native lama memakai any; kode aplikasi tetap mengikuti aturan recommended.
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['*.mjs', 'vite.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
