# OurGroceries Data Model

The upstream `getLists` command returns one mixed payload. The server should fetch that raw payload
through `OurGroceriesClient.getLists()` and transform it locally before returning MCP or CLI output.

## Top-Level Shape

- `lists`: mixed list array.
- `settings`: account/list display settings.
- `listSchemaVersion`: schema version when present.
- Other fields, such as `command` or `deadListIds`, may appear and are not exposed by focused read
  operations.

## List Types

- `SHOPPING`: visible user shopping lists. These are the only lists returned by `get_lists`.
- `MASTER`: hidden catalog of known item values. Its item IDs are master-catalog IDs.
- `CATEGORY`: hidden category container used by `get_categories`.

## Item Status

Shopping-list item status is inferred from `crossedOffAt`:

- Active item: no `crossedOffAt` property.
- Crossed-off item: numeric `crossedOffAt` epoch milliseconds.

Focused item reads return timestamps as both `epochMs` and ISO strings.

## Item Identity

Master item IDs do not match shopping-list item IDs. The practical join key for resolver work is
exact item `value`. Shopping-list mutation commands must always use shopping-list item IDs, not
master item IDs.

## Caveats

- Some upstream fields are account-specific and should not be copied into tests or docs.
- `MASTER.addedCount` is useful as a frequency signal, but target-list crossed-off recency is often
  more useful for choosing what to add or uncross.
- `get-lists.json` may be used as local analysis input only. Do not commit or expose real-account
  exports.
