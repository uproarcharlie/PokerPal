// ESLint flat config: one rule set for the whole repo (`npm run lint`, and CI's lint job).
// TypeScript rules everywhere; React hook rules (incl. the React Compiler checks) and jsx-a11y on the client.
import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "tmp/**",
      "uploads/**",
      "migrations/**",
      "client/public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_name` marks a parameter or binding that is deliberately unused (e.g. a rest-sibling omit).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // `declare global { namespace Express { ... } }` is how Express's request type is augmented.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
  {
    files: ["server/**", "scripts/**", "test/**", "*.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // A missing dependency is a stale-closure bug, not a style point.
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["client/src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    // Tailwind's preflight takes the markers off every list, and Safari then stops calling it a list
    // (no item count, no moving from item to item in VoiceOver), unless it says role="list" (P3REV-MA-VO-LISTS).
    files: ["client/src/**/*.tsx"],
    ignores: ["client/src/**/*.test.tsx"],
    rules: {
      "jsx-a11y/no-redundant-roles": ["error", { nav: ["navigation"], ul: ["list"], ol: ["list"] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name=/^(ul|ol)$/]:not(:has(JSXAttribute[name.name='role']))",
          message: 'Give a list role="list": Safari does not announce a list without markers as a list.',
        },
      ],
    },
  },
  {
    // shadcn wrappers pass their text in through `{...props}`, which these two rules cannot see.
    files: ["client/src/components/ui/**/*.tsx"],
    rules: {
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/anchor-has-content": "off",
    },
  },
  {
    // Component tests and the jsdom setup also run in the browser-like environment, with Node's globals.
    files: ["client/src/**/*.test.{ts,tsx}", "test/setup/dom.ts", "test/helpers/web.tsx"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
