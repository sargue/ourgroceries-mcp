# Item Resolution

`resolve_item_to_add` helps agents turn user text into the right OurGroceries item value and action.
It is read-only and must never mutate OurGroceries.

## Candidate Source

Candidates are the union of:

- hidden `MASTER` catalog items;
- all items seen in visible `SHOPPING` lists, active or crossed off.

Candidates are merged by exact `value`. Master metadata is preserved when present:

- `masterItemId`;
- `addedCount`;
- `masterLastAddedAt`.

Shopping-list history is tracked separately:

- occurrence count;
- number of lists where the value appeared;
- latest crossed-off timestamp;
- target-list status when `listId` is provided.

## Matching

Matching is case-insensitive and accent-insensitive. The initial implementation uses deterministic
matching only:

- `exact`: normalized value equals normalized query.
- `prefix`: one normalized string starts with the other.
- `word`: query tokens and value words overlap.
- `substring`: one normalized string contains the other.

No fuzzy-search dependency is used.

## Scoring

Scores combine:

- text match strength;
- logarithmically capped `MASTER.addedCount`;
- target-list occurrence count when `listId` is provided;
- target-list crossed-off recency;
- global crossed-off recency;
- a penalty when the candidate is already active in the target list.

Scores are evidence for ranking, not a guarantee. Agents should inspect the top candidate and action
before mutating.

## Recommended Actions

When no `listId` is provided:

```json
{ "type": "choose_list", "value": "Olivas" }
```

When the value is already active in the target list:

```json
{ "type": "already_active", "listId": "LIST_ID", "itemId": "ITEM_ID" }
```

When the value exists crossed off in the target list:

```json
{ "type": "uncross_item", "listId": "LIST_ID", "itemId": "ITEM_ID" }
```

Otherwise:

```json
{ "type": "add_item", "listId": "LIST_ID", "value": "Olivas" }
```

## Examples

For a user request like `anadir olivas`, the resolver can match a catalog value such as `Olivas`
because matching folds accents and compares words. If that value is crossed off in the target list,
the agent should call `uncross_item` rather than adding a duplicate active item.

For `milk` with no target list, the resolver can still identify a known value, but it returns
`choose_list` because mutations require a shopping-list ID.
