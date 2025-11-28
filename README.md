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

```bash
npm install
npm run build
```

## Configuration

### Quick Start (Recommended)

The easiest way to configure the server is using the CLI login command:

```bash
npx ourgroceries-mcp login
```

This will prompt you for your OurGroceries email and password, then automatically save your credentials to `~/.config/ourgroceries-mcp/config.json` (or the appropriate config directory for your platform).

### Claude Desktop Setup

After logging in, add the server to your Claude Desktop config (typically at `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ourgroceries": {
      "command": "node",
      "args": ["/path/to/ourgroceries-mcp/build/index.js"]
    }
  }
}
```

### Alternative: Manual Configuration with Environment Variables

If you prefer not to use the CLI login, you can manually configure credentials using environment variables:

1. **Get your Auth Cookie:**
   - Log in to [OurGroceries.com](https://www.ourgroceries.com)
   - Open Developer Tools (F12 or Cmd+Option+I)
   - Go to Application/Storage → Cookies → `www.ourgroceries.com`
   - Copy the `ourgroceries-auth` cookie value

2. **Get your Team ID:**
   - In Developer Tools, go to Network tab
   - Interact with your lists (add/remove an item)
   - Find a POST request to `your-lists`
   - Copy the `teamId` from the request payload

3. **Add to Claude Desktop config:**

```json
{
  "mcpServers": {
    "ourgroceries": {
      "command": "node",
      "args": ["/path/to/ourgroceries-mcp/build/index.js"],
      "env": {
        "OURGROCERIES_AUTH_COOKIE": "your-auth-cookie-value-here",
        "OURGROCERIES_TEAM_ID": "your-team-id-here"
      }
    }
  }
}
```

## Available Tools

### get_lists

Get all grocery lists with their items.

**Returns:** JSON with all lists, items, and settings.

### add_item

Add a new item to a grocery list.

**Parameters:**
- `listId` (required): The ID of the list
- `value` (required): The name of the item
- `note` (optional): A note for the item

### remove_item

Remove an item from a grocery list.

**Parameters:**
- `listId` (required): The ID of the list
- `itemId` (required): The ID of the item to remove

### update_item

Update an item's details.

**Parameters:**
- `listId` (required): The ID of the list
- `itemId` (required): The ID of the item
- `newValue` (required): The new name for the item
- `categoryId` (optional): Category ID or null
- `note` (optional): Note text
- `star` (optional): Star rating (0 or 1)

### toggle_item

Mark an item as crossed off or uncrossed.

**Parameters:**
- `listId` (required): The ID of the list
- `itemId` (required): The ID of the item
- `crossedOff` (required): true to cross off, false to uncross

## Example Usage

Once configured in Claude Desktop, you can ask:

- "What's on my grocery list?"
- "Add milk to my shopping list"
- "Mark eggs as crossed off"
- "Remove bread from the list"

## Development

Watch mode for development:

```bash
npm run watch
```

## License

MIT
