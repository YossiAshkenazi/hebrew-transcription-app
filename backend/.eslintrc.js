module.exports = {
  env: {
    browser: false,
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    'indent': ['error', 2],
    'linebreak-style': 'off', // Allow both CRLF and LF
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'warn',
    'eqeqeq': 'error',
    'curly': 'error'
  },
  ignorePatterns: [
    'node_modules/',
    'logs/',
    'migrations/',
    'seeders/'
  ]
};