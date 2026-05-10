import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {},
  }
);