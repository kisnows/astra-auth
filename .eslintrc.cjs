module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['.next/**', '.next-*/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
