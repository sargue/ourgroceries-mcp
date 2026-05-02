# Operation Contracts

MCP tools use underscore names. CLI commands use kebab-case names. CLI commands print JSON on
success and write errors to stderr.

## Read Operations

`get_lists` / `get-lists`

Returns visible shopping lists only: `id`, `name`, `itemCount`, `activeItemCount`,
`crossedOffItemCount`, and `versionId` when present. It does not return item arrays.

`get_categories` / `get-categories`

Returns categories from the hidden `CATEGORY` list. Each category has `id` and either `value`,
`name`, or both when the upstream values differ.

`get_settings` / `get-settings`

Returns `{ settings, listSchemaVersion? }` from the top-level upstream payload.

`get_active_items` / `get-active-items --list-id LIST_ID`

Returns active items from one shopping list. Active means no `crossedOffAt` property. Item fields:
`id`, `value`, `name`, and optional `barcode` and `photoId`.

`get_crossed_off_items` / `get-crossed-off-items --list-id LIST_ID`

Inputs:

- `search`: optional case- and accent-insensitive text filter.
- `crossedOffAfter`, `crossedOffBefore`: ISO date strings or epoch milliseconds, inclusive.
- `sortBy`: `crossedOffAt` or `name`, default `crossedOffAt`.
- `sortOrder`: `asc` or `desc`, default `desc`.
- `limit`: default `50`, capped at `200`.
- `offset`: default `0`.

Output:

```json
{
  "listId": "LIST_ID",
  "items": [],
  "total": 0,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

Unknown shopping-list IDs, invalid dates, negative limits, and negative offsets are errors.

## Resolver Operation

`resolve_item_to_add` / `resolve-item-to-add --query TEXT [--list-id LIST_ID] [--limit N]`

The resolver is read-only. Use it before adding ambiguous or natural-language item names. It returns
candidates with match evidence, master metadata, shopping history, target-list status when a list is
provided, and a `recommendedAction`.

Follow the recommendation:

- `already_active`: do not mutate.
- `uncross_item`: call `uncross_item` / `uncross-item`.
- `add_item`: call `add_item` / `add-item` with the candidate value.
- `choose_list`: pick a list before mutating.

## Mutation Operations

`add_item` / `add-item --list-id LIST_ID --value VALUE [--note NOTE]`

Adds a deterministic value. Resolver logic is intentionally not hidden inside this mutation.

`remove_item` / `remove-item --list-id LIST_ID --item-id ITEM_ID`

Deletes a shopping-list item.

`update_item` /
`update-item --list-id LIST_ID --item-id ITEM_ID --new-value VALUE [--category-id CATEGORY_ID] [--note NOTE] [--star 0|1]`

Updates item value and optional metadata using the existing upstream `changeItemValue` command.

`cross_off_item` / `cross-off-item --list-id LIST_ID --item-id ITEM_ID`

Calls upstream `setItemCrossedOff` with `crossedOff: true`.

`uncross_item` / `uncross-item --list-id LIST_ID --item-id ITEM_ID`

Calls upstream `setItemCrossedOff` with `crossedOff: false`.
