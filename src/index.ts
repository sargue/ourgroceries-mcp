import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { OurGroceriesClient } from "./client.js";
import type { OurGroceriesClientApi, OurGroceriesConfig } from "./client.js";
import {
  getActiveItems,
  getCategories,
  getCrossedOffItems,
  getListSummaries,
  getSettings,
  resolveItemToAdd,
} from "./data.js";
import { VERSION } from "./version.js";

export interface OurGroceriesServerOptions {
  client?: OurGroceriesClientApi;
}

export class OurGroceriesServer {
  private client: OurGroceriesClientApi;
  private server: Server;

  constructor(config: OurGroceriesConfig, options: OurGroceriesServerOptions = {}) {
    this.server = new Server(
      {
        name: "ourgroceries-mcp",
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.client = options.client ?? new OurGroceriesClient(config);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_lists",
            description:
              "Get visible shopping lists without item arrays. Use this first to choose a list ID before reading or mutating items.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_categories",
            description:
              "Get the account's OurGroceries item categories from the hidden category list.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_settings",
            description: "Get the top-level OurGroceries settings and list schema version.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_active_items",
            description:
              "Get active items on one shopping list. Active items do not have crossedOffAt.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the shopping list to read",
                },
              },
              required: ["listId"],
            },
          },
          {
            name: "get_crossed_off_items",
            description:
              "Get crossed-off items for one shopping list with optional search, date filters, sorting, and pagination.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the shopping list to read",
                },
                search: {
                  type: "string",
                  description: "Optional case- and accent-insensitive search text",
                },
                crossedOffAfter: {
                  type: ["string", "number"],
                  description:
                    "Only include items crossed off on or after this ISO date or epoch milliseconds",
                },
                crossedOffBefore: {
                  type: ["string", "number"],
                  description:
                    "Only include items crossed off on or before this ISO date or epoch milliseconds",
                },
                sortBy: {
                  type: "string",
                  enum: ["crossedOffAt", "name"],
                  default: "crossedOffAt",
                },
                sortOrder: {
                  type: "string",
                  enum: ["asc", "desc"],
                  default: "desc",
                },
                limit: {
                  type: "number",
                  description: "Maximum items to return; capped at 200",
                  default: 50,
                },
                offset: {
                  type: "number",
                  description: "Pagination offset",
                  default: 0,
                },
              },
              required: ["listId"],
            },
          },
          {
            name: "resolve_item_to_add",
            description:
              "Resolve ambiguous or natural-language item text using the master catalog and shopping-list history before adding. Follow the recommendedAction. When no listId is provided, inspect suggestedTargets; high-confidence list history can produce a list-specific action.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The user-provided item text to resolve",
                },
                listId: {
                  type: "string",
                  description: "Optional target shopping list ID",
                },
                limit: {
                  type: "number",
                  description: "Maximum candidates to return; capped at 20",
                  default: 10,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "add_item",
            description:
              "Add a deterministic item value to a grocery list. For ambiguous or natural-language names, call resolve_item_to_add first and then follow its recommendedAction.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list to add the item to",
                },
                value: {
                  type: "string",
                  description: "The name/value of the item to add",
                },
                note: {
                  type: "string",
                  description: "Optional note for the item",
                  default: "",
                },
              },
              required: ["listId", "value"],
            },
          },
          {
            name: "remove_item",
            description: "Remove an item from a grocery list",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list containing the item",
                },
                itemId: {
                  type: "string",
                  description: "The ID of the item to remove",
                },
              },
              required: ["listId", "itemId"],
            },
          },
          {
            name: "update_item",
            description: "Update an item's details (name, category, note, or star rating)",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list containing the item",
                },
                itemId: {
                  type: "string",
                  description: "The ID of the item to update",
                },
                newValue: {
                  type: "string",
                  description: "The new name/value for the item",
                },
                categoryId: {
                  type: ["string", "null"],
                  description: "Optional category ID (or null to remove category)",
                },
                note: {
                  type: "string",
                  description: "Optional note",
                  default: "",
                },
                star: {
                  type: "number",
                  description: "Star rating (0 or 1)",
                  default: 0,
                },
              },
              required: ["listId", "itemId", "newValue"],
            },
          },
          {
            name: "cross_off_item",
            description: "Mark an item as crossed off.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list containing the item",
                },
                itemId: {
                  type: "string",
                  description: "The ID of the item to cross off",
                },
              },
              required: ["listId", "itemId"],
            },
          },
          {
            name: "uncross_item",
            description:
              "Mark an item as active again. Prefer this over add_item when resolve_item_to_add recommends it.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list containing the item",
                },
                itemId: {
                  type: "string",
                  description: "The ID of the item to uncross",
                },
              },
              required: ["listId", "itemId"],
            },
          },
        ] satisfies Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "get_lists": {
            const result = getListSummaries(await this.client.getLists());

            return jsonToolResult(result);
          }

          case "get_categories": {
            const result = getCategories(await this.client.getLists());

            return jsonToolResult(result);
          }

          case "get_settings": {
            const result = getSettings(await this.client.getLists());

            return jsonToolResult(result);
          }

          case "get_active_items": {
            const args = getArguments(request.params.arguments);
            const result = getActiveItems(
              await this.client.getLists(),
              requiredStringArg(args.listId, "listId")
            );

            return jsonToolResult(result);
          }

          case "get_crossed_off_items": {
            const args = getArguments(request.params.arguments);
            const result = getCrossedOffItems(await this.client.getLists(), {
              listId: requiredStringArg(args.listId, "listId"),
              search: optionalStringArg(args.search, "search"),
              crossedOffAfter: optionalDateArg(args.crossedOffAfter, "crossedOffAfter"),
              crossedOffBefore: optionalDateArg(args.crossedOffBefore, "crossedOffBefore"),
              sortBy: optionalStringArg(args.sortBy, "sortBy") as
                | "crossedOffAt"
                | "name"
                | undefined,
              sortOrder: optionalStringArg(args.sortOrder, "sortOrder") as
                | "asc"
                | "desc"
                | undefined,
              limit: optionalNumberArg(args.limit, "limit"),
              offset: optionalNumberArg(args.offset, "offset"),
            });

            return jsonToolResult(result);
          }

          case "resolve_item_to_add": {
            const args = getArguments(request.params.arguments);
            const result = resolveItemToAdd(await this.client.getLists(), {
              query: requiredStringArg(args.query, "query"),
              listId: optionalStringArg(args.listId, "listId"),
              limit: optionalNumberArg(args.limit, "limit"),
            });

            return jsonToolResult(result);
          }

          case "add_item": {
            const args = getArguments(request.params.arguments);
            const listId = requiredStringArg(args.listId, "listId");
            const value = requiredStringArg(args.value, "value");
            const note = optionalStringArg(args.note, "note") ?? "";

            await this.client.addItem({
              listId,
              value,
              note,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully added "${value}" to the list`,
                },
              ],
            };
          }

          case "remove_item": {
            const args = getArguments(request.params.arguments);
            const listId = requiredStringArg(args.listId, "listId");
            const itemId = requiredStringArg(args.itemId, "itemId");

            await this.client.removeItem({
              listId,
              itemId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully removed item from the list`,
                },
              ],
            };
          }

          case "update_item": {
            const args = getArguments(request.params.arguments);
            const listId = requiredStringArg(args.listId, "listId");
            const itemId = requiredStringArg(args.itemId, "itemId");
            const newValue = requiredStringArg(args.newValue, "newValue");
            const categoryId = optionalNullableStringArg(args.categoryId, "categoryId");
            const note = optionalStringArg(args.note, "note") ?? "";
            const star = optionalNumberArg(args.star, "star") ?? 0;

            await this.client.updateItem({
              listId,
              itemId,
              newValue,
              categoryId,
              note,
              star,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully updated item to "${newValue}"`,
                },
              ],
            };
          }

          case "cross_off_item": {
            const args = getArguments(request.params.arguments);
            const listId = requiredStringArg(args.listId, "listId");
            const itemId = requiredStringArg(args.itemId, "itemId");

            await this.client.crossOffItem({
              listId,
              itemId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: "Successfully crossed off item",
                },
              ],
            };
          }

          case "uncross_item": {
            const args = getArguments(request.params.arguments);
            const listId = requiredStringArg(args.listId, "listId");
            const itemId = requiredStringArg(args.itemId, "itemId");

            await this.client.uncrossItem({
              listId,
              itemId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: "Successfully uncrossed item",
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async connect(transport: Transport) {
    await this.server.connect(transport);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.connect(transport);
    console.error("OurGroceries MCP server running on stdio");
  }
}

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function getArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function requiredStringArg(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

function optionalStringArg(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

function optionalNullableStringArg(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string or null`);
  }

  return value;
}

function optionalNumberArg(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

function optionalDateArg(value: unknown, name: string): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`${name} must be a string or number`);
  }

  return value;
}
