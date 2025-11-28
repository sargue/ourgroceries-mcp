import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const API_URL = "https://www.ourgroceries.com/your-lists";

interface OurGroceriesConfig {
  authCookie: string;
  teamId: string;
}

export class OurGroceriesServer {
  private server: Server;
  private config: OurGroceriesConfig;

  constructor(config: OurGroceriesConfig) {
    this.server = new Server(
      {
        name: "ourgroceries-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.config = config;
    this.setupHandlers();
  }

  private async makeRequest(command: Record<string, any>): Promise<any> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Cookie: `ourgroceries-auth=${this.config.authCookie}`,
      },
      body: JSON.stringify({
        ...command,
        teamId: this.config.teamId,
        shareId: null,
        locale: "en-US",
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_lists",
            description:
              "Get all grocery lists with their items. Returns list names, IDs, and all items with their status.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "add_item",
            description:
              "Add a new item to a grocery list. You can optionally add a note.",
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
            description:
              "Update an item's details (name, category, note, or star rating)",
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
            name: "toggle_item",
            description: "Mark an item as crossed off or uncrossed",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The ID of the list containing the item",
                },
                itemId: {
                  type: "string",
                  description: "The ID of the item to toggle",
                },
                crossedOff: {
                  type: "boolean",
                  description: "Whether the item should be crossed off (true) or not (false)",
                },
              },
              required: ["listId", "itemId", "crossedOff"],
            },
          },
        ] satisfies Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "get_lists": {
            const result = await this.makeRequest({
              command: "getLists",
              knownLists: [],
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "add_item": {
            const { listId, value, note = "" } = request.params.arguments as {
              listId: string;
              value: string;
              note?: string;
            };

            const result = await this.makeRequest({
              command: "insertItem",
              listId,
              value,
              note,
              isFromRecipe: false,
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
            const { listId, itemId } = request.params.arguments as {
              listId: string;
              itemId: string;
            };

            const result = await this.makeRequest({
              command: "deleteItem",
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
            const {
              listId,
              itemId,
              newValue,
              categoryId = null,
              note = "",
              star = 0,
            } = request.params.arguments as {
              listId: string;
              itemId: string;
              newValue: string;
              categoryId?: string | null;
              note?: string;
              star?: number;
            };

            const result = await this.makeRequest({
              command: "changeItemValue",
              listId,
              itemId,
              newValue,
              categoryId,
              note,
              photoId: "",
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

          case "toggle_item": {
            const { listId, itemId, crossedOff } = request.params.arguments as {
              listId: string;
              itemId: string;
              crossedOff: boolean;
            };

            const result = await this.makeRequest({
              command: "setItemCrossedOff",
              listId,
              itemId,
              crossedOff,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully ${crossedOff ? "crossed off" : "uncrossed"} item`,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OurGroceries MCP server running on stdio");
  }
}
