import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // One-off Node scripts (e.g. the Pixelpanik image import).
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
);
