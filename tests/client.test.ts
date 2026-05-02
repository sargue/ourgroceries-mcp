import assert from "node:assert/strict";
import test from "node:test";

import { OURGROCERIES_API_URL, OurGroceriesClient } from "../src/client.js";

interface FetchCall {
  init: Parameters<typeof fetch>[1];
  input: Parameters<typeof fetch>[0];
}

function createJsonResponse(
  body: unknown,
  { ok = true, status = 200, statusText = "OK" } = {}
): Response {
  return {
    json: async () => body,
    ok,
    status,
    statusText,
  } as Response;
}

function createFetch(responses: Response[]) {
  const pendingResponses = [...responses];
  const calls: FetchCall[] = [];

  const fetchImpl = (async (input, init) => {
    calls.push({ init, input });

    const response = pendingResponses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch call to ${String(input)}`);
    }

    return response;
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function getHeaders(init: RequestInit | undefined): Record<string, string> {
  assert.ok(init?.headers);
  assert.equal(Array.isArray(init.headers), false);
  assert.equal(init.headers instanceof Headers, false);

  return init.headers as Record<string, string>;
}

function getJsonBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") {
    assert.fail("Expected request body to be a string");
  }

  return JSON.parse(body) as Record<string, unknown>;
}

test("getLists posts the shared OurGroceries request envelope", async () => {
  const { calls, fetchImpl } = createFetch([createJsonResponse({ lists: [] })]);
  const client = new OurGroceriesClient(
    {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    },
    { fetchImpl }
  );

  assert.deepEqual(await client.getLists(), { lists: [] });

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].input), OURGROCERIES_API_URL);
  assert.equal(calls[0].init?.method, "POST");

  const headers = getHeaders(calls[0].init);
  assert.equal(headers["Content-Type"], "application/json; charset=UTF-8");
  assert.equal(headers.Cookie, "ourgroceries-auth=auth-cookie-value");

  assert.deepEqual(getJsonBody(calls[0].init), {
    command: "getLists",
    knownLists: [],
    teamId: "team-id-value",
    shareId: null,
    locale: "en-US",
  });
});

test("mutation methods construct the existing OurGroceries commands", async () => {
  const { calls, fetchImpl } = createFetch([
    createJsonResponse({}),
    createJsonResponse({}),
    createJsonResponse({}),
    createJsonResponse({}),
  ]);
  const client = new OurGroceriesClient(
    {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    },
    { fetchImpl }
  );

  await client.addItem({ listId: "list-id", value: "milk" });
  await client.removeItem({ listId: "list-id", itemId: "item-id" });
  await client.updateItem({ listId: "list-id", itemId: "item-id", newValue: "whole milk" });
  await client.toggleItem({ listId: "list-id", itemId: "item-id", crossedOff: true });

  assert.deepEqual(
    calls.map((call) => getJsonBody(call.init)),
    [
      {
        command: "insertItem",
        listId: "list-id",
        value: "milk",
        note: "",
        isFromRecipe: false,
        teamId: "team-id-value",
        shareId: null,
        locale: "en-US",
      },
      {
        command: "deleteItem",
        listId: "list-id",
        itemId: "item-id",
        teamId: "team-id-value",
        shareId: null,
        locale: "en-US",
      },
      {
        command: "changeItemValue",
        listId: "list-id",
        itemId: "item-id",
        newValue: "whole milk",
        categoryId: null,
        note: "",
        photoId: "",
        star: 0,
        teamId: "team-id-value",
        shareId: null,
        locale: "en-US",
      },
      {
        command: "setItemCrossedOff",
        listId: "list-id",
        itemId: "item-id",
        crossedOff: true,
        teamId: "team-id-value",
        shareId: null,
        locale: "en-US",
      },
    ]
  );
});

test("client rejects non-OK OurGroceries responses", async () => {
  const { fetchImpl } = createFetch([
    createJsonResponse(
      { error: "expired" },
      { ok: false, status: 401, statusText: "Unauthorized" }
    ),
  ]);
  const client = new OurGroceriesClient(
    {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    },
    { fetchImpl }
  );

  await assert.rejects(client.getLists(), /API request failed: 401 Unauthorized/);
});
