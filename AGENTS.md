# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript MCP server package. Source files live in `src/` and compile to `build/`, which is ignored by Git and included in the published npm package. Key modules are:

- `src/index.ts`: MCP server, tool definitions, and tool-to-client dispatch.
- `src/cli.ts`: `ourgroceries-mcp` command, login/logout workflow, JSON CLI commands, and no-arg server startup.
- `src/client.ts`: OurGroceries HTTP client and request envelope construction.
- `src/auth.ts`: OurGroceries sign-in and team ID extraction.
- `src/config.ts`: credential config path, load, and save helpers.
- `src/version.ts`: package version loading for the MCP server and CLI.

Tests live in `tests/` and compile to `build-test/`, which is ignored by Git.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm ci`: install the exact locked dependency set for verification or CI.
- `npm run build`: run `tsc` and emit ESM output plus declarations into `build/`.
- `npm test`: compile tests with `tsconfig.test.json` and run Node's built-in test runner.
- `npm run lint`: run ESLint.
- `npm run format:check`: verify Prettier formatting.
- `npm run check`: run build, lint, format check, and tests.
- `npm run watch`: run TypeScript in watch mode during local development.
- `node build/cli.js login`: authenticate and write local credentials after building.
- `node build/cli.js logout`: remove saved local credentials after building.
- `node build/cli.js get-lists`: print raw list JSON using local credentials.
- `node build/cli.js add-item --list-id LIST_ID --value VALUE [--note NOTE]`: add an item and print JSON success.
- `node build/cli.js remove-item --list-id LIST_ID --item-id ITEM_ID`: remove an item and print JSON success.
- `node build/cli.js update-item --list-id LIST_ID --item-id ITEM_ID --new-value VALUE [--category-id CATEGORY_ID] [--note NOTE] [--star 0|1]`: update an item and print JSON success.
- `node build/cli.js toggle-item --list-id LIST_ID --item-id ITEM_ID --crossed-off|--uncrossed`: toggle an item and print JSON success.
- `node build/cli.js`: after building and configuring credentials, start the MCP server over stdio.

Before opening a PR, run `npm run check`. For dependency review, also run `npm audit --audit-level=moderate`.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules and explicit `.js` extensions in relative imports, matching `moduleResolution: "Node16"`. Follow the existing style: two-space indentation, double quotes, semicolons, `camelCase` for variables/functions, `PascalCase` for interfaces/classes, and comments only where behavior is non-obvious. Keep API command names, MCP tool names, CLI command names, and JSON success fields stable unless intentionally breaking.

## Testing Guidelines

Tests use Node's built-in `node:test` runner with `assert/strict`. For behavior changes, prefer focused tests around auth parsing, config path handling, OurGroceries client request construction, MCP tool request handling, and CLI command parsing/output. Name tests after the module or behavior, for example `auth.test.ts`, `client.test.ts`, `cli.test.ts`, or `config.test.ts`.

Avoid real network calls in automated tests. Mock `fetch`, inject a mock `OurGroceriesClientApi`, or use in-memory MCP transports as appropriate.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, capitalized subjects such as `Fix login cookie capture from redirect response` and `Prepare package for NPM publication`. Keep commits focused and avoid mixing formatting-only edits with behavior changes.

Pull requests should describe user-facing CLI or MCP behavior, note any credential/config migration impact, link related issues, and include the result of `npm run check`. Include screenshots only for documentation or terminal output changes.

## Security & Configuration Tips

Do not commit `.env`, generated `build/`, or local credential files. Credentials are stored in `~/.config/ourgroceries-mcp/config.json` on macOS/Linux or `%APPDATA%\ourgroceries-mcp\config.json` on Windows. Avoid logging full auth cookies or passwords, including in debug output.
