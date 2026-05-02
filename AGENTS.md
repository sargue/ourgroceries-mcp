# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript MCP server package. Source files live in `src/` and compile to `build/`, which is ignored by Git and included in the published npm package. Key modules are:

- `src/index.ts`: MCP server, tool definitions, and OurGroceries API calls.
- `src/cli.ts`: `ourgroceries-mcp` command, login workflow, and server startup.
- `src/auth.ts`: OurGroceries sign-in and team ID extraction.
- `src/config.ts`: credential config path, load, and save helpers.

There is no committed test directory yet. Add tests beside the relevant module or under `tests/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run build`: run `tsc` and emit ESM output plus declarations into `build/`.
- `npm run watch`: run TypeScript in watch mode during local development.
- `node build/cli.js login`: authenticate and write local credentials after building.
- `node build/cli.js`: after building and configuring credentials, start the MCP server over stdio.

There is no `npm test` script. Before opening a PR, at minimum run `npm run build`.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules and explicit `.js` extensions in relative imports, matching `moduleResolution: "Node16"`. Follow the existing style: two-space indentation, double quotes, semicolons, `camelCase` for variables/functions, `PascalCase` for interfaces/classes, and comments only where behavior is non-obvious. Keep API command names and MCP tool names stable unless intentionally breaking.

## Testing Guidelines

No test framework is configured. For behavior changes, prefer focused tests around auth parsing, config path handling, and MCP tool request handling. Name tests after the module or behavior, for example `auth.test.ts` or `config.test.ts`, and add a package script so contributors can run them consistently.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, capitalized subjects such as `Fix login cookie capture from redirect response` and `Prepare package for NPM publication`. Keep commits focused and avoid mixing formatting-only edits with behavior changes.

Pull requests should describe user-facing CLI or MCP behavior, note any credential/config migration impact, link related issues, and include the result of `npm run build`. Include screenshots only for documentation or terminal output changes.

## Security & Configuration Tips

Do not commit `.env`, generated `build/`, or local credential files. Credentials are stored in `~/.config/ourgroceries-mcp/config.json` on macOS/Linux or `%APPDATA%\ourgroceries-mcp\config.json` on Windows. Avoid logging full auth cookies or passwords, including in debug output.
