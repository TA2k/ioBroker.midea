import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: [
            "**/node_modules/**",
            ".references/**",
            "admin/words.js",
            ".dev-server/**",
            "build/**",
            "package-lock.json",
        ],
    },
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.cjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.es2022,
                ...globals.mocha,
            },
        },
        rules: {
            indent: ["error", 4, { SwitchCase: 1 }],
            "no-console": "off",
            "no-var": "error",
            "prefer-const": "error",
            quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
            semi: ["error", "always"],
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
        },
    },
    {
        files: ["**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2022,
            },
        },
    },
];
