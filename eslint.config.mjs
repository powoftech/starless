// @ts-check

import eslint from "@eslint/js"
import prettierConfig from "eslint-config-prettier"
import perfectionist from "eslint-plugin-perfectionist"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  perfectionist.configs["recommended-natural"],
  {
    rules: {
      "perfectionist/sort-objects": [
        "error",
        {
          type: "unsorted",
        },
      ],
    },
  },
  prettierConfig,
)
