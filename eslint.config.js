import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SRC_TS = ['src/**/*.ts'];

// Type-aware linting for src/ (#1827 Part B.2). The rules recommendedTypeChecked
// adds on top of `recommended` are downgraded to warnings: their existing hits
// are ratcheted debt in scripts/eslint-baseline.json, like no-explicit-any, and
// "0 errors" keeps meaning nothing in src/ is known-broken.
const rulesOf = (configs) => Object.assign({}, ...configs.map((c) => c.rules ?? {}));
const recommendedRules = rulesOf(tseslint.configs.recommended);
const typeAwareAsWarnings = Object.fromEntries(
    Object.entries(rulesOf(tseslint.configs.recommendedTypeChecked))
        .filter(([rule, level]) => !(rule in recommendedRules) && level !== 'off')
        .map(([rule, level]) => [rule, Array.isArray(level) ? ['warn', ...level.slice(1)] : 'warn'])
);

const DEBUG_BOUNDARY = {
    regex: '(^|/)debug(/|$)',
    message:
        'world/, systems/ and foliage/ must not depend on src/debug/. Report through utils/debug-hooks.ts (#1827).',
};
const barrelBoundary = (regex) => ({
    regex,
    message:
        'Foliage modules import the defining module, not the foliage barrel (src/foliage/index.ts). See scripts/check-foliage-barrel.mjs.',
});

// #1972: a UA regex ("ci" in "Macintosh") put every Mac in CI mode. Ask
// core/platform (getRunMode, getPlatformCapabilities) instead; reporting code
// reads the raw string through readUserAgent().
const USER_AGENT_ALLOWED = ['src/core/platform/**'];
const NO_USER_AGENT = {
    object: 'navigator',
    property: 'userAgent',
    message:
        'Read navigator.userAgent only in src/core/platform/. Use getRunMode() / getPlatformCapabilities(), or readUserAgent() for reporting.',
};

// #2027: game input goes through the action layer (core/input/actions), whose
// context stack decides who gets a key. A global key listener bypasses it.
// Element-scoped listeners (a widget's own Enter/Space) are DOM focus
// handling and stay. Remaining sites are warnings, ratcheted by `npm run lint`
// (one block, so this rule's selectors can't replace another block's).
const GLOBAL_KEYS_ALLOWED = ['src/core/input/**', 'src/utils/focus-trap.ts'];
const NO_GLOBAL_KEYS = {
    selector:
        "CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^key(down|up|press)$/]:matches([callee.object.name=/^(window|document)$/], [callee.object.object.name='document'])",
    message:
        'Global key listeners belong in src/core/input/. Bind an action (core/input/actions/bindings.ts) and use input.onPress() / input.get(); see docs/INPUT.md.',
};

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'public/**',
            'src/wasm/**',
            'assembly/**',
            'emscripten/**',
            'tools/**',
            'tests/**',
            'test/**',
            'verification/**',
            'scripts/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: SRC_TS })),
    {
        files: SRC_TS,
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        rules: typeAwareAsWarnings,
    },
    prettierConfig,
    {
        plugins: {
            import: importPlugin,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        settings: {
            'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
            'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.mjs'] } },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'import/order': [
                'warn',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                    alphabetize: { order: 'asc', caseInsensitive: true },
                    'newlines-between': 'never',
                },
            ],
            // Runtime import cycles are at zero (scripts/cycles-baseline.json); keep them there.
            'import/no-cycle': ['error', { ignoreExternal: true }],
        },
    },
    // Module boundaries (#1827 Part B.2). One block per file set, because a
    // later `no-restricted-imports` entry replaces an earlier one rather than
    // merging with it.
    {
        files: ['src/world/**/*.ts', 'src/systems/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [DEBUG_BOUNDARY] }],
        },
    },
    {
        files: ['src/foliage/*.ts'],
        ignores: ['src/foliage/index.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: [DEBUG_BOUNDARY, barrelBoundary('^\\.(/index(\\.ts)?)?/?$')] },
            ],
        },
    },
    {
        files: ['src/foliage/*/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: [DEBUG_BOUNDARY, barrelBoundary('^\\.\\.(/index(\\.ts)?)?/?$')] },
            ],
        },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.js'],
        ignores: USER_AGENT_ALLOWED,
        rules: { 'no-restricted-properties': ['error', NO_USER_AGENT] },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.js'],
        ignores: GLOBAL_KEYS_ALLOWED,
        rules: { 'no-restricted-syntax': ['warn', NO_GLOBAL_KEYS] },
    },
    {
        // #1973: simulation and world generation draw from seeded streams, so a
        // seed plus an input log replays the same world and the same run.
        // (Repeats NO_USER_AGENT: this block's options replace the one above.)
        files: ['src/systems/physics/**/*.ts', 'src/systems/fauna/**/*.ts', 'src/world/**/*.ts'],
        rules: {
            'no-restricted-properties': [
                'error',
                NO_USER_AGENT,
                {
                    object: 'Math',
                    property: 'random',
                    message:
                        'Use simRng (utils/sim-rng.ts, ctx.rng in a system) in fixed-step simulation, or getSeededRandom() (utils/seeded-random.ts) in world generation.',
                },
            ],
        },
    },
    {
        files: ['src/utils/log.ts'],
        rules: {
            // log.ts is the single allowed console sink.
            'no-console': 'off',
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            // TypeScript compiler handles undefined names in .ts files.
            'no-undef': 'off',
        },
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            'no-undef': 'error',
        },
    }
);
