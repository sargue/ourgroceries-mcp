# OurGroceries MCP Server

A Model Context Protocol (MCP) server for managing grocery lists on OurGroceries.com.

## Features

This MCP server provides tools to:

- Get visible shopping-list summaries without raw item arrays
- Get categories, settings, active items, and crossed-off item history
- Resolve natural-language item requests against the master catalog and shopping history
- Add items to lists
- Remove items from lists
- Update item details (name, category, notes, star rating)
- Cross off and uncross items

## Installation

The npm package is published as `@sergib/ourgroceries-mcp`. The installed executable remains
`ourgroceries-mcp`.

### Step 1: Login to OurGroceries

Authenticate with your OurGroceries account:

```bash
npx -y @sergib/ourgroceries-mcp login
```

Enter your email and password when prompted.

The login command saves an OurGroceries auth cookie and team ID. It does not save your password.

### Step 2: Add to Claude

#### For Claude Code

```bash
claude mcp add ourgroceries npx -y @sergib/ourgroceries-mcp
```

#### For Claude Desktop

Add to your configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ourgroceries": {
      "command": "npx",
      "args": ["-y", "@sergib/ourgroceries-mcp"]
    }
  }
}
```

Then restart Claude Desktop.

## Credentials

By default, credentials are stored in a local config file:

- macOS/Linux: `~/.config/ourgroceries-mcp/config.json`
- Windows: `%APPDATA%\ourgroceries-mcp\config.json`

On macOS and Linux, the config file is written with owner-only `0600` permissions where supported.

To remove saved credentials:

```bash
npx -y @sergib/ourgroceries-mcp logout
```

`logout` removes the saved config file only. It does not modify environment variables.

### Environment-variable fallback

If there is no usable config file, the server can read credentials from environment variables:

- `OURGROCERIES_AUTH_COOKIE`
- `OURGROCERIES_TEAM_ID`

Both variables must be set. A saved config file takes priority over environment variables. If the
saved config file is invalid and both environment variables are set, the server warns and uses the
environment variables.

### Troubleshooting Credentials

If the server reports missing or invalid credentials, run:

```bash
npx -y @sergib/ourgroceries-mcp login
```

Then restart your MCP client. If you use environment variables instead of the config file, refresh
both variables. Login debug output from `npx -y @sergib/ourgroceries-mcp login --debug` redacts
passwords, auth cookies, and cookie headers.

## What You Can Do

- **View your lists:** See shopping-list IDs and item counts without dumping every item
- **Read items:** Get active items or filtered crossed-off history for one list
- **Resolve item names:** Turn natural-language item text into the value OurGroceries has seen before
- **Add items:** Add deterministic item values to any list with optional notes
- **Remove items:** Delete items from your lists
- **Update items:** Change item names, categories, notes, or star ratings
- **Check off items:** Cross items off or uncross previously crossed-off items

## Recommended Add Flow

For ambiguous item names, use the resolver before mutating a list:

1. Call `resolve_item_to_add` with the user's text and, when known, `listId`.
2. Review the top candidate and its `recommendedAction`.
3. Call `add_item` only when the recommendation is `add_item`.
4. Call `uncross_item` when the recommendation is `uncross_item`.
5. Do not mutate when the recommendation is `already_active`.

## Example Usage

Once configured, you can ask Claude:

- "What's on my grocery list?"
- "Add milk to my shopping list"
- "Mark eggs as crossed off"
- "Remove bread from the list"
- "Update the note on bananas to say 'organic'"

## License

MIT

## Developer CLI Usage

Build first, then run the local binary directly:

```bash
npm ci
npm run build
node build/cli.js
```

Running `node build/cli.js` with no subcommand starts the MCP server over stdio, matching the
package's `ourgroceries-mcp` binary behavior.

For local CLI testing with your own OurGroceries account, authenticate once:

```bash
node build/cli.js login
```

The CLI uses the same credentials as MCP mode: saved config file first, then the
`OURGROCERIES_AUTH_COOKIE` and `OURGROCERIES_TEAM_ID` environment-variable fallback. `logout`
removes only the saved config file:

```bash
node build/cli.js logout
```

Operational commands print JSON on success and write errors to stderr with a nonzero exit code.
They use explicit IDs for mutations. Use focused reads and the resolver before mutating items:

```bash
node build/cli.js get-lists
node build/cli.js get-categories
node build/cli.js get-settings
node build/cli.js get-active-items --list-id LIST_ID
node build/cli.js get-crossed-off-items --list-id LIST_ID --search "milk" --limit 20
node build/cli.js resolve-item-to-add --query "add olives" --list-id LIST_ID
node build/cli.js add-item --list-id LIST_ID --value "milk" --note "2%"
node build/cli.js remove-item --list-id LIST_ID --item-id ITEM_ID
node build/cli.js update-item --list-id LIST_ID --item-id ITEM_ID --new-value "whole milk" --star 1
node build/cli.js cross-off-item --list-id LIST_ID --item-id ITEM_ID
node build/cli.js uncross-item --list-id LIST_ID --item-id ITEM_ID
```

Reference docs for maintainers live in `docs/`.

Before sending CLI changes, run:

```bash
npm run check
npm audit --audit-level=moderate
```
