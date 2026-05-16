---
name: ourgroceries-cli
description: Use the @sergib/ourgroceries-mcp package as an OurGroceries command-line interface. Use when the agent needs to inspect, search, add, update, remove, cross off, uncross, or otherwise manage OurGroceries shopping lists through terminal commands; when a user asks for OurGroceries CLI usage; or when JSON output from grocery-list operations is useful.
---

# OurGroceries CLI

## Overview

Use the `@sergib/ourgroceries-mcp` CLI for OurGroceries operations. Prefer the CLI when the user
wants concrete list data, scriptable JSON output, or terminal-driven mutations.

## Critical Rule: Never Permanently Remove Items

**MANDATORY:** Never call `remove-item`. Always use `cross-off-item` instead.

Whenever the user asks to remove, delete, eliminate, erase, take off, get rid of, drop, scratch,
take out, or any equivalent verb in any language (e.g. Spanish "quitar", "eliminar", "borrar",
"sacar"; Catalan "treure", "eliminar", "esborrar"; French "enlever", "supprimer"; German
"entfernen", "löschen"; etc.), treat the request as a **cross-off** and run `cross-off-item`.

This applies even when the user explicitly says "remove" or "delete" — the user's intent is to
clear the item from the active list, and crossing it off preserves history and OurGroceries'
learning behavior. Never use `remove-item` unless the user explicitly insists on permanent deletion
after being told that cross-off is the default and confirms they want destructive removal anyway.

## Authentication

The CLI reads saved credentials first, then `OURGROCERIES_AUTH_COOKIE` and
`OURGROCERIES_TEAM_ID`.

If credentials are missing, tell the user to run:

```bash
npx -y @sergib/ourgroceries-mcp login
```

Do not ask the user for their OurGroceries password in chat. Do not pass passwords on the command
line. `logout` removes the saved config file and does not modify environment variables:

```bash
npx -y @sergib/ourgroceries-mcp logout
```

## Read Workflow

Start with lists unless the user already gave a `listId`:

```bash
npx -y @sergib/ourgroceries-mcp get-lists
```

Use IDs from that output for focused reads:

```bash
npx -y @sergib/ourgroceries-mcp get-active-items --list-id LIST_ID
npx -y @sergib/ourgroceries-mcp get-crossed-off-items --list-id LIST_ID --search "milk" --limit 20
npx -y @sergib/ourgroceries-mcp get-categories
npx -y @sergib/ourgroceries-mcp get-settings
```

Parse JSON from stdout. Summarize the relevant result for the user instead of dumping raw JSON,
unless the user explicitly asks for raw output.

## Mutation Workflow

Use resolver-first behavior for item add requests, including when the user gives only an item name,
a partial name, or a name without accents:

```bash
npx -y @sergib/ourgroceries-mcp resolve-item-to-add --query "plátanos"
```

Follow `recommendedAction` first. The resolver is read-only and can recommend a list-specific action
even when `--list-id` was not provided, using `suggestedTargets` from active items, recent
crossed-off history, crossed-off rank, and repeated list occurrences.

- `add_item`: run `add-item` with the resolved value.
- `uncross_item`: run `uncross-item` with the returned item ID.
- `already_active`: do not mutate.
- `choose_list`: inspect `suggestedTargets`; ask the user only when the list is still ambiguous or no
  useful list history exists.

When the user names a target list, pass its ID to the resolver:

```bash
npx -y @sergib/ourgroceries-mcp resolve-item-to-add --query "add olives" --list-id LIST_ID
```

For bare item requests, do not call `add-item` directly. Resolve first, then use the exact candidate
`value` and returned list/item IDs. Prefer `uncross-item` over `add-item` when the resolver says the
item exists crossed off, because that avoids duplicate active items.

Mutation commands:

```bash
npx -y @sergib/ourgroceries-mcp add-item --list-id LIST_ID --value "milk" --note "2%"
npx -y @sergib/ourgroceries-mcp update-item --list-id LIST_ID --item-id ITEM_ID --new-value "whole milk" --star 1
npx -y @sergib/ourgroceries-mcp cross-off-item --list-id LIST_ID --item-id ITEM_ID
npx -y @sergib/ourgroceries-mcp uncross-item --list-id LIST_ID --item-id ITEM_ID
```

`remove-item` exists in the CLI but is forbidden by this skill — see the Critical Rule above. Map
every "remove"/"delete"/"erase" style request to `cross-off-item`.

For update, cross-off (including any "remove"-style request), or uncross requests by item name,
read the target list first to resolve the item ID. Ask a brief clarifying question before mutating
when the list or item is ambiguous.

## Errors

Operational failures are written to stderr and use nonzero exit codes. For missing or rejected
credentials, direct the user to rerun `login`. For network or upstream OurGroceries failures, report
the failed command and the stderr message.
