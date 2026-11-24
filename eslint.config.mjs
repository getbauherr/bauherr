import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

const root = fileURLToPath(new URL('.', import.meta.url))
const serverSrc = 'apps/server/src'

export const LIB_ALLOWLIST = [
  'secrets',
  'connection',
  'adapters',
  'people',
  'person',
  'gateway',
  'path-sets',
  'knowledge',
  'db-pool',
]

const WRITABLE_BACKENDS = ['GithubBackend', 'GitlabBackend', 'FakeBackend']

const modulesDir = join(root, serverSrc, 'modules')
const moduleNames = existsSync(modulesDir)
  ? readdirSync(modulesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

const syntax = (selector, message) => ({ selector, message })

const testGlobs = ['**/tests/**', '**/test/**', '**/e2e/**', '**/*.test.ts', '**/*.spec.ts']

const everywhereSyntax = [
  syntax(
    'TSAsExpression > TSNeverKeyword.typeAnnotation',
    'Do not cast to never. Parse the value with a zod schema or narrow it with a type guard so the type is real.',
  ),
  syntax(
    'TSAsExpression > TSAsExpression.expression > TSUnknownKeyword.typeAnnotation',
    'Do not cast through unknown. Parse the value with a zod schema at the boundary, or fix the type at its source.',
  ),
  syntax(
    ':matches(TSTypeReference[typeName.name="Record"] > TSTypeParameterInstantiation > TSAnyKeyword)',
    'Do not use Record<string, any>. Name the shape with a type, or use Record<string, unknown> and parse the values.',
  ),
  syntax(
    'MemberExpression[property.name=/^(skip|only|todo)$/]:matches([object.name=/^(test|it|describe)$/], [object.object.name=/^(test|it|describe)$/])',
    'Do not skip, focus or park a test. Fix the cause of the failure, or delete the test with the feature it covered.',
  ),
]

const coreSyntax = [
  syntax(
    'MemberExpression[object.name="process"][property.name="env"]',
    'Do not read process.env here. Read the setting once in src/lib and pass the value in as a parameter.',
  ),
  syntax(
    'CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate)$/]',
    'Do not use timers. A run ends and never waits: schedule the follow-up as a job in src/jobs, or end the run with a Question card.',
  ),
  syntax(
    'CallExpression[callee.object.name="globalThis"][callee.property.name=/^(setTimeout|setInterval|setImmediate|fetch)$/]',
    'Do not use timers or fetch through globalThis. Schedule a job in src/jobs, or call the forge through src/core/forge.',
  ),
  syntax(
    'CallExpression[callee.property.name=/^(update|delete)$/]:matches([callee.object.name="payload"], [callee.object.property.name="payload"]):has(> ObjectExpression > Property[key.name="where"])',
    'Do not update or delete records in bulk with where. Go through the record store, which changes one record by id and declares the fields it writes.',
  ),
  syntax(
    'CallExpression[callee.name="fetch"]',
    'Do not call fetch here. Go through src/core/forge for the forge and src/lib/gateway for the gateway.',
  ),
]

const libRestriction = {
  group: ['**/lib/**', ...LIB_ALLOWLIST.flatMap((name) => [`!**/lib/${name}`, `!**/lib/${name}/**`])],
  message:
    'src/core and src/modules import src/lib only through the allowlist in eslint.config.mjs. Use an allowed lib file, move the code into src/core, or add the file to LIB_ALLOWLIST in a reviewed change.',
}

const forgeWriteRestrictions = [
  {
    group: ['**/lib/adapters'],
    importNames: ['backendFor'],
    message:
      'Only src/core/forge may build a forge backend that can write. Call a function exported from src/core/forge, or take the read-only forge type as a parameter.',
  },
]

const adaptersPackage = {
  name: '@bauherr/adapters',
  importNames: WRITABLE_BACKENDS,
  message:
    'Only src/core/forge may import a forge backend that can write. Call a function exported from src/core/forge, or take the read-only forge type as a parameter.',
}

const importRule = (patterns, paths = []) => ['error', { patterns, paths }]
const syntaxRule = (selectors) => ['error', ...selectors]

const coreNoModules = {
  group: ['**/modules', '**/modules/**'],
  message: 'src/core never imports src/modules. Move the shared code into src/core, or let the module hand it to core through its module definition.',
}

const sizeRules = {
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: false }],
  'max-len': ['error', { code: 120, ignoreUrls: false }],
  complexity: ['error', { max: 10 }],
}

export const hasMessages = (entry) => (typeof entry === 'string' ? false : Boolean(entry?.message))

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.test-dist/**',
      '**/next-env.d.ts',
      'apps/server/src/migrations/index.ts',
      'apps/server/e2e/results/**',
      'apps/server/playwright-report/**',
      'docs/site/site/**',
    ],
  },
  {
    files: ['apps/**/*.{ts,tsx,mts}', 'packages/**/*.{ts,tsx,mts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          './apps/server/tsconfig.json',
          './packages/adapters/tsconfig.test.json',
          './packages/cli/tsconfig.test.json',
          './packages/runner/tsconfig.json',
        ],
        tsconfigRootDir: root,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      ...sizeRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          'ts-nocheck': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      'no-restricted-syntax': syntaxRule(everywhereSyntax),
    },
  },
  {
    files: testGlobs,
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    name: 'migrations are generated SQL that must stay byte-identical once applied, so the size rules do not apply',
    files: [`${serverSrc}/migrations/**/*.ts`],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
  {
    files: [`${serverSrc}/core/**/*.{ts,tsx}`, `${serverSrc}/modules/**/*.{ts,tsx}`],
    rules: { 'no-restricted-syntax': syntaxRule([...everywhereSyntax, ...coreSyntax]) },
  },
  {
    files: [`${serverSrc}/modules/**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': importRule([libRestriction, ...forgeWriteRestrictions], [adaptersPackage]) },
  },
  {
    files: [`${serverSrc}/core/**/*.{ts,tsx}`],
    ignores: [`${serverSrc}/core/forge/**`],
    rules: {
      'no-restricted-imports': importRule([libRestriction, coreNoModules, ...forgeWriteRestrictions], [adaptersPackage]),
    },
  },
  {
    files: [`${serverSrc}/core/forge/**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': importRule([libRestriction, coreNoModules]) },
  },
  ...moduleNames.map((name) => ({
    files: [`${serverSrc}/modules/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': importRule(
        [
          libRestriction,
          ...forgeWriteRestrictions,
          ...moduleNames
            .filter((other) => other !== name)
            .map((other) => ({
              group: [`**/modules/${other}`, `**/modules/${other}/**`, `../${other}`, `../${other}/**`, `../../${other}`, `../../${other}/**`],
              message:
                'Modules do not import each other. Move the shared code into src/core or pass it through the record.',
            })),
        ],
        [adaptersPackage],
      ),
    },
  })),
  {
    files: ['apps/server/e2e/**/*.ts', 'apps/server/playwright.config.ts', 'apps/server/vitest.integration.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { project: null, projectService: false } },
  },
)
