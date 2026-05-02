import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type {
  AddItemInput,
  CrossOffItemInput,
  OurGroceriesClientApi,
  RemoveItemInput,
  UpdateItemInput,
} from "../src/client.js";
import { OurGroceriesServer } from "../src/index.js";

type MockClientCall =
  | { method: "getLists" }
  | { input: AddItemInput; method: "addItem" }
  | { input: RemoveItemInput; method: "removeItem" }
  | { input: UpdateItemInput; method: "updateItem" }
  | { input: CrossOffItemInput; method: "crossOffItem" }
  | { input: CrossOffItemInput; method: "uncrossItem" };

interface ToolContentResult {
  content: Array<{ text?: string; type: string }>;
  isError?: boolean;
}

const crossedOffAt = Date.UTC(2024, 0, 2);

function createRawListsPayload() {
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
            id: "active-id",
            value: "Milk",
            name: "Milk",
          },
          {
            id: "crossed-id",
            value: "Olivas",
            name: "Olivas",
            crossedOffAt,
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
            addedCount: 8,
            lastAddedAt: crossedOffAt,
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

class MockOurGroceriesClient implements OurGroceriesClientApi {
  calls: MockClientCall[] = [];
  error: Error | null = null;
  getListsResult: unknown = createRawListsPayload();

  async getLists(): Promise<unknown> {
    this.throwIfNeeded();
    this.calls.push({ method: "getLists" });

    return this.getListsResult;
  }

  async addItem(input: AddItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "addItem" });
  }

  async removeItem(input: RemoveItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "removeItem" });
  }

  async updateItem(input: UpdateItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "updateItem" });
  }

  async crossOffItem(input: CrossOffItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "crossOffItem" });
  }

  async uncrossItem(input: CrossOffItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "uncrossItem" });
  }

  private throwIfNeeded() {
    if (this.error) {
      throw this.error;
    }
  }
}

async function withConnectedServer(
  run: (context: { mcpClient: Client; ourGroceriesClient: MockOurGroceriesClient }) => Promise<void>
) {
  const ourGroceriesClient = new MockOurGroceriesClient();
  const server = new OurGroceriesServer(
    {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    },
    { client: ourGroceriesClient }
  );
  const mcpClient = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  try {
    await run({ mcpClient, ourGroceriesClient });
  } finally {
    await mcpClient.close();
  }
}

function asToolContentResult(result: Awaited<ReturnType<Client["callTool"]>>): ToolContentResult {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    assert.fail("Expected a tool content result");
  }

  return result as ToolContentResult;
}

function assertTextResult(result: Awaited<ReturnType<Client["callTool"]>>, text: string) {
  const contentResult = asToolContentResult(result);
  const firstContent = contentResult.content[0];
  if (!firstContent || firstContent.type !== "text") {
    assert.fail("Expected first tool content item to be text");
  }

  assert.equal(firstContent.text, text);
}

function parseTextJson(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const contentResult = asToolContentResult(result);
  const text = contentResult.content[0]?.text;
  if (!text) {
    assert.fail("Expected text content");
  }

  return JSON.parse(text) as unknown;
}

test("MCP server lists the focused OurGroceries tools", async () => {
  await withConnectedServer(async ({ mcpClient }) => {
    const result = await mcpClient.listTools();

    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      [
        "get_lists",
        "get_categories",
        "get_settings",
        "get_active_items",
        "get_crossed_off_items",
        "resolve_item_to_add",
        "add_item",
        "remove_item",
        "update_item",
        "cross_off_item",
        "uncross_item",
      ]
    );

    const resolverTool = result.tools.find((tool) => tool.name === "resolve_item_to_add");
    assert.ok(resolverTool);
    assert.deepEqual(resolverTool.inputSchema.required, ["query"]);

    const addItemTool = result.tools.find((tool) => tool.name === "add_item");
    assert.ok(addItemTool);
    assert.match(addItemTool.description ?? "", /resolve_item_to_add/);
  });
});

test("MCP read tools transform the raw OurGroceries payload", async () => {
  await withConnectedServer(async ({ mcpClient, ourGroceriesClient }) => {
    assert.deepEqual(
      parseTextJson(await mcpClient.callTool({ name: "get_lists", arguments: {} })),
      [
        {
          id: "list-id",
          name: "Groceries",
          itemCount: 2,
          activeItemCount: 1,
          crossedOffItemCount: 1,
          versionId: "version-1",
        },
      ]
    );

    assert.deepEqual(
      parseTextJson(await mcpClient.callTool({ name: "get_categories", arguments: {} })),
      [{ id: "category-id", value: "Produce" }]
    );

    assert.deepEqual(
      parseTextJson(await mcpClient.callTool({ name: "get_settings", arguments: {} })),
      {
        settings: {
          showPhotos: true,
        },
        listSchemaVersion: 6,
      }
    );

    assert.deepEqual(
      parseTextJson(
        await mcpClient.callTool({
          name: "get_active_items",
          arguments: { listId: "list-id" },
        })
      ),
      [{ id: "active-id", value: "Milk", name: "Milk" }]
    );

    assert.deepEqual(
      parseTextJson(
        await mcpClient.callTool({
          name: "get_crossed_off_items",
          arguments: { listId: "list-id", search: "olí", limit: 1 },
        })
      ),
      {
        listId: "list-id",
        items: [
          {
            id: "crossed-id",
            value: "Olivas",
            name: "Olivas",
            crossedOffAt: {
              epochMs: crossedOffAt,
              iso: new Date(crossedOffAt).toISOString(),
            },
          },
        ],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      }
    );

    const resolverResult = parseTextJson(
      await mcpClient.callTool({
        name: "resolve_item_to_add",
        arguments: { query: "añadir olivas", listId: "list-id" },
      })
    ) as { candidates: Array<{ recommendedAction: unknown; value: string }> };

    assert.equal(resolverResult.candidates[0]?.value, "Olivas");
    assert.deepEqual(resolverResult.candidates[0]?.recommendedAction, {
      type: "uncross_item",
      listId: "list-id",
      itemId: "crossed-id",
    });

    assert.deepEqual(ourGroceriesClient.calls, [
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
    ]);
  });
});

test("MCP mutation tool calls dispatch to the OurGroceries client", async () => {
  await withConnectedServer(async ({ mcpClient, ourGroceriesClient }) => {
    assertTextResult(
      await mcpClient.callTool({
        name: "add_item",
        arguments: { listId: "list-id", value: "milk" },
      }),
      'Successfully added "milk" to the list'
    );
    assertTextResult(
      await mcpClient.callTool({
        name: "remove_item",
        arguments: { listId: "list-id", itemId: "item-id" },
      }),
      "Successfully removed item from the list"
    );
    assertTextResult(
      await mcpClient.callTool({
        name: "update_item",
        arguments: { listId: "list-id", itemId: "item-id", newValue: "whole milk" },
      }),
      'Successfully updated item to "whole milk"'
    );
    assertTextResult(
      await mcpClient.callTool({
        name: "cross_off_item",
        arguments: { listId: "list-id", itemId: "item-id" },
      }),
      "Successfully crossed off item"
    );
    assertTextResult(
      await mcpClient.callTool({
        name: "uncross_item",
        arguments: { listId: "list-id", itemId: "item-id" },
      }),
      "Successfully uncrossed item"
    );

    assert.deepEqual(ourGroceriesClient.calls, [
      { input: { listId: "list-id", value: "milk", note: "" }, method: "addItem" },
      { input: { listId: "list-id", itemId: "item-id" }, method: "removeItem" },
      {
        input: {
          listId: "list-id",
          itemId: "item-id",
          newValue: "whole milk",
          categoryId: null,
          note: "",
          star: 0,
        },
        method: "updateItem",
      },
      {
        input: { listId: "list-id", itemId: "item-id" },
        method: "crossOffItem",
      },
      {
        input: { listId: "list-id", itemId: "item-id" },
        method: "uncrossItem",
      },
    ]);
  });
});

test("MCP tool errors keep the existing text error shape", async () => {
  await withConnectedServer(async ({ mcpClient, ourGroceriesClient }) => {
    ourGroceriesClient.error = new Error("upstream failed");

    const result = await mcpClient.callTool({ name: "get_lists", arguments: {} });
    const contentResult = asToolContentResult(result);

    assert.equal(contentResult.isError, true);
    assertTextResult(result, "Error: upstream failed");
  });
});
