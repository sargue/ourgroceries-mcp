import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type {
  AddItemInput,
  OurGroceriesClientApi,
  RemoveItemInput,
  ToggleItemInput,
  UpdateItemInput,
} from "../src/client.js";
import { OurGroceriesServer } from "../src/index.js";

type MockClientCall =
  | { method: "getLists" }
  | { input: AddItemInput; method: "addItem" }
  | { input: RemoveItemInput; method: "removeItem" }
  | { input: UpdateItemInput; method: "updateItem" }
  | { input: ToggleItemInput; method: "toggleItem" };

interface ToolContentResult {
  content: Array<{ text?: string; type: string }>;
  isError?: boolean;
}

class MockOurGroceriesClient implements OurGroceriesClientApi {
  calls: MockClientCall[] = [];
  error: Error | null = null;
  getListsResult: unknown = {
    lists: [{ id: "list-id", name: "Grocery List", items: [] }],
  };

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

  async toggleItem(input: ToggleItemInput): Promise<void> {
    this.throwIfNeeded();
    this.calls.push({ input, method: "toggleItem" });
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

test("MCP server lists the existing OurGroceries tools", async () => {
  await withConnectedServer(async ({ mcpClient }) => {
    const result = await mcpClient.listTools();

    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      ["get_lists", "add_item", "remove_item", "update_item", "toggle_item"]
    );

    const addItemTool = result.tools.find((tool) => tool.name === "add_item");
    assert.ok(addItemTool);
    assert.deepEqual(addItemTool.inputSchema.required, ["listId", "value"]);

    const noteSchema = addItemTool.inputSchema.properties?.note as
      | { default?: unknown }
      | undefined;
    assert.equal(noteSchema?.default, "");
  });
});

test("MCP tool calls dispatch to the OurGroceries client", async () => {
  await withConnectedServer(async ({ mcpClient, ourGroceriesClient }) => {
    assertTextResult(
      await mcpClient.callTool({ name: "get_lists", arguments: {} }),
      JSON.stringify(ourGroceriesClient.getListsResult, null, 2)
    );
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
        name: "toggle_item",
        arguments: { listId: "list-id", itemId: "item-id", crossedOff: false },
      }),
      "Successfully uncrossed item"
    );

    assert.deepEqual(ourGroceriesClient.calls, [
      { method: "getLists" },
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
        input: { listId: "list-id", itemId: "item-id", crossedOff: false },
        method: "toggleItem",
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
