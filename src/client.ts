export const OURGROCERIES_API_URL = "https://www.ourgroceries.com/your-lists";
const CREDENTIALS_HELP =
  'Run "npx -y @sergib/ourgroceries-mcp login" again, then restart your MCP client. If you use environment variables, refresh OURGROCERIES_AUTH_COOKIE and OURGROCERIES_TEAM_ID.';

export interface OurGroceriesConfig {
  authCookie: string;
  teamId: string;
}

export interface AddItemInput {
  listId: string;
  value: string;
  note?: string;
}

export interface RemoveItemInput {
  listId: string;
  itemId: string;
}

export interface UpdateItemInput {
  listId: string;
  itemId: string;
  newValue: string;
  categoryId?: string | null;
  note?: string;
  star?: number;
}

export interface CrossOffItemInput {
  listId: string;
  itemId: string;
}

export interface OurGroceriesClientApi {
  getLists(): Promise<unknown>;
  addItem(input: AddItemInput): Promise<void>;
  removeItem(input: RemoveItemInput): Promise<void>;
  updateItem(input: UpdateItemInput): Promise<void>;
  crossOffItem(input: CrossOffItemInput): Promise<void>;
  uncrossItem(input: CrossOffItemInput): Promise<void>;
}

export interface OurGroceriesClientOptions {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  locale?: string;
}

export class OurGroceriesClient implements OurGroceriesClientApi {
  private readonly apiUrl: string;
  private readonly config: OurGroceriesConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly locale: string;

  constructor(config: OurGroceriesConfig, options: OurGroceriesClientOptions = {}) {
    this.apiUrl = options.apiUrl ?? OURGROCERIES_API_URL;
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? getDefaultFetch();
    this.locale = options.locale ?? "en-US";
  }

  async getLists(): Promise<unknown> {
    return await this.makeRequest({
      command: "getLists",
      knownLists: [],
    });
  }

  async addItem({ listId, value, note = "" }: AddItemInput): Promise<void> {
    await this.makeRequest({
      command: "insertItem",
      listId,
      value,
      note,
      isFromRecipe: false,
    });
  }

  async removeItem({ listId, itemId }: RemoveItemInput): Promise<void> {
    await this.makeRequest({
      command: "deleteItem",
      listId,
      itemId,
    });
  }

  async updateItem({
    listId,
    itemId,
    newValue,
    categoryId = null,
    note = "",
    star = 0,
  }: UpdateItemInput): Promise<void> {
    await this.makeRequest({
      command: "changeItemValue",
      listId,
      itemId,
      newValue,
      categoryId,
      note,
      photoId: "",
      star,
    });
  }

  async crossOffItem(input: CrossOffItemInput): Promise<void> {
    await this.setItemCrossedOff(input, true);
  }

  async uncrossItem(input: CrossOffItemInput): Promise<void> {
    await this.setItemCrossedOff(input, false);
  }

  private async setItemCrossedOff(
    { listId, itemId }: CrossOffItemInput,
    crossedOff: boolean
  ): Promise<void> {
    await this.makeRequest({
      command: "setItemCrossedOff",
      listId,
      itemId,
      crossedOff,
    });
  }

  private async makeRequest(command: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Cookie: `ourgroceries-auth=${this.config.authCookie}`,
      },
      body: JSON.stringify({
        ...command,
        teamId: this.config.teamId,
        shareId: null,
        locale: this.locale,
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `OurGroceries rejected the configured credentials (${formatResponseStatus(response)}). ${CREDENTIALS_HELP}`
        );
      }

      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error(
        `OurGroceries returned an unexpected response. The configured credentials may be invalid or expired. ${CREDENTIALS_HELP}`
      );
    }
  }
}

function formatResponseStatus(response: Response): string {
  return response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
}

function getDefaultFetch(): typeof fetch {
  if (globalThis.fetch) {
    return globalThis.fetch.bind(globalThis);
  }

  return (async (...args: Parameters<typeof fetch>) => {
    const { default: nodeFetch } = await import("node-fetch");

    return (await nodeFetch(
      args[0] as Parameters<typeof nodeFetch>[0],
      args[1] as Parameters<typeof nodeFetch>[1]
    )) as unknown as Response;
  }) as typeof fetch;
}
