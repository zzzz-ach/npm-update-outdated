import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import-x';

export default [
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'max-len': ['error', { code: 200 }],
      'import-x/extensions': ['error', 'ignorePackages'],
    },
  },
];
