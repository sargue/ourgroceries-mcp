# OurGroceries MCP Server

A Model Context Protocol (MCP) server for managing grocery lists on OurGroceries.com.

## Features

This MCP server provides tools to:

- Get all grocery lists and their items
- Add items to lists
- Remove items from lists
- Update item details (name, category, notes, star rating)
- Toggle items as crossed off/uncrossed

## Installation

### Step 1: Login to OurGroceries

Authenticate with your OurGroceries account:

```bash
npx ourgroceries-mcp login
```

Enter your email and password when prompted.

The login command saves an OurGroceries auth cookie and team ID. It does not save your password.

### Step 2: Add to Claude

#### For Claude Code

```bash
claude mcp add ourgroceries npx ourgroceries-mcp
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
      "args": ["ourgroceries-mcp"]
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
npx ourgroceries-mcp logout
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
npx ourgroceries-mcp login
```

Then restart your MCP client. If you use environment variables instead of the config file, refresh
both variables. Login debug output from `npx ourgroceries-mcp login --debug` redacts passwords,
auth cookies, and cookie headers.

## What You Can Do

- **View your lists:** See all your grocery lists and items
- **Add items:** Add new items to any list with optional notes
- **Remove items:** Delete items from your lists
- **Update items:** Change item names, categories, notes, or star ratings
- **Check off items:** Mark items as crossed off or uncrossed

## Example Usage

Once configured, you can ask Claude:

- "What's on my grocery list?"
- "Add milk to my shopping list"
- "Mark eggs as crossed off"
- "Remove bread from the list"
- "Update the note on bananas to say 'organic'"

## License

MIT
