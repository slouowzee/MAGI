import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, Bun: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-shadow': 'error',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
    },
  },
  { files: ['**/*.test.js'], rules: { 'no-shadow': 'off' } },
];
