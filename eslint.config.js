import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // `.netlify` is Netlify's build cache (restored between builds; it held Deno
  // output from a removed edge function and broke every later production lint).
  {
    ignores: [
      'dist',
      'dist-*',
      'coverage',
      'UI',
      'src/contracts/generated',
      'supabase/functions',
      '.netlify',
      'e2e/.stack',
      'test-results',
      'playwright-report',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'pilot/scripts/**/*.mjs', 'e2e/stack/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Served verbatim from `public/`, so it never passes through the bundler and
    // runs in a worker rather than a page: `self` and `clients` exist, `window`
    // and `document` do not. Without this it lints against no environment at all
    // and every worker global reads as undefined.
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2022, globals: globals.serviceworker },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
