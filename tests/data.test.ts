import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveItems,
  getCategories,
  getCrossedOffItems,
  getListSummaries,
  getSettings,
  resolveItemToAdd,
} from "../src/data.js";

const oldCrossedOffAt = Date.UTC(2023, 6, 1);
const recentCrossedOffAt = Date.UTC(2024, 0, 2);

function createPayload() {
  return {
    listSchemaVersion: 6,
    settings: {
      showPhotos: true,
    },
    lists: [
      {
        id: "list-id",
        name: "Groceries",
        listType: "SHOPPING",
        versionId: "version-1",
        items: [
          {
            id: "active-milk-id",
            value: "Milk",
            name: "Milk",
            barcode: "123",
          },
          {
            id: "crossed-olivas-id",
            value: "Olivas",
            name: "Olivas",
            crossedOffAt: recentCrossedOffAt,
          },
          {
            id: "crossed-oil-id",
            value: "Olive oil",
            name: "Olive oil",
            crossedOffAt: oldCrossedOffAt,
          },
        ],
      },
      {
        id: "second-list-id",
        name: "Other",
        listType: "SHOPPING",
        items: [
          {
            id: "other-olivas-id",
            value: "Olivas Rellenas",
            name: "Olivas Rellenas",
            crossedOffAt: oldCrossedOffAt,
          },
        ],
      },
      {
        id: "master-list-id",
        name: "All Items",
        listType: "MASTER",
        items: [
          {
            id: "master-olivas-id",
            value: "Olivas",
            name: "Olivas",
            addedCount: 20,
            lastAddedAt: recentCrossedOffAt,
          },
          {
            id: "master-olivas-rellenas-id",
            value: "Olivas Rellenas",
            name: "Olivas Rellenas",
            addedCount: 6,
            lastAddedAt: oldCrossedOffAt,
          },
          {
            id: "master-milk-id",
            value: "Milk",
            name: "Milk",
            addedCount: 30,
            lastAddedAt: oldCrossedOffAt,
          },
          {
            id: "master-flour-id",
            value: "Flour",
            name: "Flour",
            addedCount: 3,
          },
        ],
      },
      {
        id: "category-list-id",
        name: "Categories",
        listType: "CATEGORY",
        items: [
          {
            id: "category-id",
            value: "Produce",
            name: "Produce",
          },
        ],
      },
    ],
  };
}

test("extracts focused list, category, settings, and active item views", () => {
  const payload = createPayload();

  assert.deepEqual(getListSummaries(payload), [
    {
      id: "list-id",
      name: "Groceries",
      itemCount: 3,
      activeItemCount: 1,
      crossedOffItemCount: 2,
      versionId: "version-1",
    },
    {
      id: "second-list-id",
      name: "Other",
      itemCount: 1,
      activeItemCount: 0,
      crossedOffItemCount: 1,
    },
  ]);
  assert.deepEqual(getCategories(payload), [{ id: "category-id", value: "Produce" }]);
  assert.deepEqual(getSettings(payload), {
    settings: {
      showPhotos: true,
    },
    listSchemaVersion: 6,
  });
  assert.deepEqual(getActiveItems(payload, "list-id"), [
    {
      id: "active-milk-id",
      value: "Milk",
      name: "Milk",
      barcode: "123",
    },
  ]);
});

test("filters, sorts, paginates, and timestamps crossed-off items", () => {
  const payload = createPayload();

  assert.deepEqual(getCrossedOffItems(payload, { listId: "list-id", limit: 1 }), {
    listId: "list-id",
    items: [
      {
        id: "crossed-olivas-id",
        value: "Olivas",
        name: "Olivas",
        crossedOffAt: {
          epochMs: recentCrossedOffAt,
          iso: new Date(recentCrossedOffAt).toISOString(),
        },
      },
    ],
    total: 2,
    limit: 1,
    offset: 0,
    hasMore: true,
  });

  assert.deepEqual(
    getCrossedOffItems(payload, {
      listId: "list-id",
      search: "olí",
      crossedOffBefore: new Date(recentCrossedOffAt - 1).toISOString(),
      sortBy: "name",
      sortOrder: "asc",
    }).items.map((item) => item.value),
    ["Olive oil"]
  );
});

test("validates crossed-off query inputs", () => {
  const payload = createPayload();

  assert.throws(
    () => getCrossedOffItems(payload, { listId: "missing-list-id" }),
    /Unknown shopping list ID: missing-list-id/
  );
  assert.throws(
    () => getCrossedOffItems(payload, { listId: "list-id", crossedOffAfter: "not-a-date" }),
    /crossedOffAfter must be a valid date or epoch milliseconds/
  );
  assert.throws(
    () => getCrossedOffItems(payload, { listId: "list-id", limit: -1 }),
    /limit must be a non-negative integer/
  );
});

test("resolves item text using master frequency and target-list history", () => {
  const result = resolveItemToAdd(createPayload(), {
    query: "añadir olivas",
    listId: "list-id",
  });

  assert.equal(result.candidates[0]?.value, "Olivas");
  assert.equal(result.candidates[0]?.targetList?.status, "crossed_off");
  assert.deepEqual(result.candidates[0]?.recommendedAction, {
    type: "uncross_item",
    listId: "list-id",
    itemId: "crossed-olivas-id",
  });
  assert.equal(result.candidates[0]?.masterItemId, "master-olivas-id");
  assert.equal(result.candidates[0]?.history.shoppingOccurrenceCount, 1);
  assert.deepEqual(result.candidates[0]?.suggestedTargets[0], {
    listId: "list-id",
    listName: "Groceries",
    score: 86,
    confidence: "high",
    status: "crossed_off",
    itemId: "crossed-olivas-id",
    value: "Olivas",
    evidence: {
      occurrenceCount: 1,
      activeOccurrenceCount: 0,
      crossedOffOccurrenceCount: 1,
      latestCrossedOffAt: {
        epochMs: recentCrossedOffAt,
        iso: new Date(recentCrossedOffAt).toISOString(),
      },
      crossedOffRank: 1,
      crossedOffCount: 2,
    },
    recommendedAction: {
      type: "uncross_item",
      listId: "list-id",
      itemId: "crossed-olivas-id",
    },
  });
});

test("resolver recommends list actions from high-confidence suggestions", () => {
  const payload = createPayload();

  assert.deepEqual(
    resolveItemToAdd(payload, { query: "milk", listId: "list-id" }).candidates[0]
      ?.recommendedAction,
    {
      type: "already_active",
      listId: "list-id",
      itemId: "active-milk-id",
    }
  );

  const milkWithoutList = resolveItemToAdd(payload, { query: "milk" }).candidates[0];
  assert.deepEqual(milkWithoutList?.recommendedAction, {
    type: "already_active",
    listId: "list-id",
    itemId: "active-milk-id",
  });
  assert.equal(milkWithoutList?.suggestedTargets[0]?.listName, "Groceries");

  assert.deepEqual(resolveItemToAdd(payload, { query: "flour" }).candidates[0]?.recommendedAction, {
    type: "choose_list",
    value: "Flour",
  });
  assert.throws(
    () => resolveItemToAdd(payload, { query: "   " }),
    /query must be a non-empty string/
  );
});
