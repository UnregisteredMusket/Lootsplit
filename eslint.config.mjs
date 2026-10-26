import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the TanStack Start app-builder template. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "android/app/src/main/assets/**", // Capacitor copies the already-checked mobile build here.
      "android/**/build/**", // Generated Gradle output; native source has its own Android lint gate.
      "test-results/**", // Generated browser reports and traces, not application source.
      ".output/**",
      ".wrangler/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "public/ocr/**", // Generated, pinned third-party runtime; source is not app code.
      "src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Native dialogs are unthemed system boxes in the Android WebView and block the page:
    // use useConfirm / usePrompt (src/lib/quire/confirm-store.ts) instead (design audit D7).
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/**/*.test.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["confirm", "prompt", "alert"].map((name) => ({
          name,
          message: "Use useConfirm()/usePrompt() from @/lib/quire/confirm-store.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          ["confirm", "prompt", "alert"].map((property) => ({
            object,
            property,
            message: "Use useConfirm()/usePrompt() from @/lib/quire/confirm-store.",
          })),
        ),
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
