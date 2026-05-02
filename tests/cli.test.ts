import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type {
  AddItemInput,
  CrossOffItemInput,
  OurGroceriesClientApi,
  RemoveItemInput,
  UpdateItemInput,
} from "../src/client.js";
import { createProgram } from "../src/cli.js";
import type { Config } from "../src/config.js";

interface CliResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

interface RunningCliResult extends CliResult {
  signal: NodeJS.Signals | null;
}

interface CliProgramResult {
  configs: Config[];
  stderr: string;
  stdout: string;
}

interface TempCliHome {
  appData: string;
  configPath: string;
  home: string;
}

type MockClientCall =
  | { method: "getLists" }
  | { input: AddItemInput; method: "addItem" }
  | { input: RemoveItemInput; method: "removeItem" }
  | { input: UpdateItemInput; method: "updateItem" }
  | { input: CrossOffItemInput; method: "crossOffItem" }
  | { input: CrossOffItemInput; method: "uncrossItem" };

const cliEnvNames = [
  "APPDATA",
  "HOME",
  "OURGROCERIES_AUTH_COOKIE",
  "OURGROCERIES_TEAM_ID",
  "USERPROFILE",
] as const;
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
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
  getListsResult: unknown = createRawListsPayload();

  async getLists(): Promise<unknown> {
    this.calls.push({ method: "getLists" });

    return this.getListsResult;
  }

  async addItem(input: AddItemInput): Promise<void> {
    this.calls.push({ input, method: "addItem" });
  }

  async removeItem(input: RemoveItemInput): Promise<void> {
    this.calls.push({ input, method: "removeItem" });
  }

  async updateItem(input: UpdateItemInput): Promise<void> {
    this.calls.push({ input, method: "updateItem" });
  }

  async crossOffItem(input: CrossOffItemInput): Promise<void> {
    this.calls.push({ input, method: "crossOffItem" });
  }

  async uncrossItem(input: CrossOffItemInput): Promise<void> {
    this.calls.push({ input, method: "uncrossItem" });
  }
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8")) as {
    version: string;
  };

  return packageJson.version;
}

async function withTempCliHome(run: (tempCliHome: TempCliHome) => Promise<void>) {
  const home = await fs.mkdtemp(join(tmpdir(), "ourgroceries-mcp-cli-"));
  const appData = join(home, "AppData", "Roaming");
  const configPath =
    process.platform === "win32"
      ? join(appData, "ourgroceries-mcp", "config.json")
      : join(home, ".config", "ourgroceries-mcp", "config.json");

  try {
    await run({ appData, configPath, home });
  } finally {
    await fs.rm(home, { force: true, recursive: true });
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

async function runCliUntilStderr(
  args: string[],
  env: NodeJS.ProcessEnv,
  pattern: RegExp
): Promise<RunningCliResult> {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let matched = false;

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;

    if (!matched && pattern.test(stderr)) {
      matched = true;
      child.kill("SIGTERM");
    }
  });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for CLI stderr to match ${pattern}`));
    }, 5000);

    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);

      if (!matched) {
        reject(new Error(`CLI stderr did not match ${pattern}. stderr: ${stderr}`));
        return;
      }

      resolve({ code, signal, stderr, stdout });
    });
  });
}

async function writeConfig(configPath: string, config: { authCookie: string; teamId: string }) {
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config), "utf-8");
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout) as unknown;
}

async function runCliProgram(
  args: string[],
  env: NodeJS.ProcessEnv,
  client: MockOurGroceriesClient
): Promise<CliProgramResult> {
  return await withCliEnv(env, async () => {
    let stdout = "";
    let stderr = "";
    const configs: Config[] = [];
    const program = createProgram({
      clientFactory: (config) => {
        configs.push(config);
        return client;
      },
      stderr: (message) => {
        stderr += message;
      },
      stdout: (message) => {
        stdout += message;
      },
    });

    program.exitOverride();
    await program.parseAsync(["node", "ourgroceries-mcp", ...args]);

    return { configs, stderr, stdout };
  });
}

async function withCliEnv<T>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T> {
  const originalEnv = new Map<string, string | undefined>();

  for (const name of cliEnvNames) {
    originalEnv.set(name, process.env[name]);
    delete process.env[name];
  }

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[name] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("CLI reports the package version", async () => {
  const result = await runCli(["--version"], {});

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), await readPackageVersion());
});

test("login command help remains available without running authentication", async () => {
  const result = await runCli(["login", "--help"], {});

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Log in to OurGroceries and save credentials/);
});

test("logout removes the saved config file without modifying environment variables", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await writeConfig(configPath, {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    });

    const result = await runCli(["logout"], {
      APPDATA: appData,
      HOME: home,
      OURGROCERIES_AUTH_COOKIE: "env-auth-cookie-value",
      OURGROCERIES_TEAM_ID: "env-team-id-value",
      USERPROFILE: home,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Removed saved credentials from:/);
    assert.match(result.stdout, /Environment variables are not modified by logout/);
    await assert.rejects(fs.access(configPath), /ENOENT/);
  });
});

test("CLI with no subcommand starts MCP stdio mode", async () => {
  await withTempCliHome(async ({ appData, home }) => {
    const result = await runCliUntilStderr(
      [],
      {
        APPDATA: appData,
        HOME: home,
        OURGROCERIES_AUTH_COOKIE: "env-auth-cookie-value",
        OURGROCERIES_TEAM_ID: "env-team-id-value",
        USERPROFILE: home,
      },
      /OurGroceries MCP server running on stdio/
    );

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /OurGroceries MCP server running on stdio/);
  });
});

test("get-lists prints focused JSON and uses environment credentials when no config exists", async () => {
  await withTempCliHome(async ({ appData, home }) => {
    const client = new MockOurGroceriesClient();
    const result = await runCliProgram(
      ["get-lists"],
      {
        APPDATA: appData,
        HOME: home,
        OURGROCERIES_AUTH_COOKIE: "env-auth-cookie-value",
        OURGROCERIES_TEAM_ID: "env-team-id-value",
        USERPROFILE: home,
      },
      client
    );

    assert.equal(result.stderr, "");
    assert.deepEqual(parseJson(result.stdout), [
      {
        id: "list-id",
        name: "Groceries",
        itemCount: 2,
        activeItemCount: 1,
        crossedOffItemCount: 1,
        versionId: "version-1",
      },
    ]);
    assert.deepEqual(result.configs, [
      {
        authCookie: "env-auth-cookie-value",
        teamId: "env-team-id-value",
      },
    ]);
    assert.deepEqual(client.calls, [{ method: "getLists" }]);
  });
});

test("operational commands prefer saved config credentials over environment credentials", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await writeConfig(configPath, {
      authCookie: "config-auth-cookie-value",
      teamId: "config-team-id-value",
    });

    const client = new MockOurGroceriesClient();
    client.getListsResult = { lists: [] };

    const result = await runCliProgram(
      ["get-lists"],
      {
        APPDATA: appData,
        HOME: home,
        OURGROCERIES_AUTH_COOKIE: "env-auth-cookie-value",
        OURGROCERIES_TEAM_ID: "env-team-id-value",
        USERPROFILE: home,
      },
      client
    );

    assert.equal(result.stderr, "");
    assert.deepEqual(parseJson(result.stdout), []);
    assert.deepEqual(result.configs, [
      {
        authCookie: "config-auth-cookie-value",
        teamId: "config-team-id-value",
      },
    ]);
    assert.deepEqual(client.calls, [{ method: "getLists" }]);
  });
});

test("read commands transform raw list data and print stable JSON", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await writeConfig(configPath, {
      authCookie: "config-auth-cookie-value",
      teamId: "config-team-id-value",
    });

    const client = new MockOurGroceriesClient();
    const env = {
      APPDATA: appData,
      HOME: home,
      USERPROFILE: home,
    };

    const categoriesResult = await runCliProgram(["get-categories"], env, client);
    const settingsResult = await runCliProgram(["get-settings"], env, client);
    const activeItemsResult = await runCliProgram(
      ["get-active-items", "--list-id", "list-id"],
      env,
      client
    );
    const crossedOffItemsResult = await runCliProgram(
      ["get-crossed-off-items", "--list-id", "list-id", "--search", "olí", "--limit", "1"],
      env,
      client
    );
    const resolverResult = await runCliProgram(
      ["resolve-item-to-add", "--query", "añadir olivas", "--list-id", "list-id"],
      env,
      client
    );

    assert.equal(categoriesResult.stderr, "");
    assert.deepEqual(parseJson(categoriesResult.stdout), [{ id: "category-id", value: "Produce" }]);

    assert.equal(settingsResult.stderr, "");
    assert.deepEqual(parseJson(settingsResult.stdout), {
      settings: {
        showPhotos: true,
      },
      listSchemaVersion: 6,
    });

    assert.equal(activeItemsResult.stderr, "");
    assert.deepEqual(parseJson(activeItemsResult.stdout), [
      { id: "active-id", value: "Milk", name: "Milk" },
    ]);

    assert.equal(crossedOffItemsResult.stderr, "");
    assert.deepEqual(parseJson(crossedOffItemsResult.stdout), {
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
    });

    const parsedResolverResult = parseJson(resolverResult.stdout) as {
      candidates: Array<{ recommendedAction: unknown; value: string }>;
    };
    assert.equal(resolverResult.stderr, "");
    assert.equal(parsedResolverResult.candidates[0]?.value, "Olivas");
    assert.deepEqual(parsedResolverResult.candidates[0]?.recommendedAction, {
      type: "uncross_item",
      listId: "list-id",
      itemId: "crossed-id",
    });

    assert.deepEqual(client.calls, [
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
      { method: "getLists" },
    ]);
  });
});

test("mutation commands call the expected client methods and print stable JSON", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await writeConfig(configPath, {
      authCookie: "config-auth-cookie-value",
      teamId: "config-team-id-value",
    });

    const client = new MockOurGroceriesClient();
    const env = {
      APPDATA: appData,
      HOME: home,
      USERPROFILE: home,
    };

    const addResult = await runCliProgram(
      ["add-item", "--list-id", "list-id", "--value", "milk", "--note", "2%"],
      env,
      client
    );
    const removeResult = await runCliProgram(
      ["remove-item", "--list-id", "list-id", "--item-id", "item-id"],
      env,
      client
    );
    const updateResult = await runCliProgram(
      [
        "update-item",
        "--list-id",
        "list-id",
        "--item-id",
        "item-id",
        "--new-value",
        "whole milk",
        "--note",
        "cold",
        "--star",
        "1",
      ],
      env,
      client
    );
    const crossOffResult = await runCliProgram(
      ["cross-off-item", "--list-id", "list-id", "--item-id", "item-id"],
      env,
      client
    );
    const uncrossResult = await runCliProgram(
      ["uncross-item", "--list-id", "list-id", "--item-id", "item-id"],
      env,
      client
    );

    assert.equal(addResult.stderr, "");
    assert.deepEqual(addResult.configs, [
      {
        authCookie: "config-auth-cookie-value",
        teamId: "config-team-id-value",
      },
    ]);
    assert.deepEqual(parseJson(addResult.stdout), {
      ok: true,
      operation: "add_item",
      listId: "list-id",
      value: "milk",
      note: "2%",
    });

    assert.equal(removeResult.stderr, "");
    assert.deepEqual(parseJson(removeResult.stdout), {
      ok: true,
      operation: "remove_item",
      listId: "list-id",
      itemId: "item-id",
    });

    assert.equal(updateResult.stderr, "");
    assert.deepEqual(parseJson(updateResult.stdout), {
      ok: true,
      operation: "update_item",
      listId: "list-id",
      itemId: "item-id",
      newValue: "whole milk",
      categoryId: null,
      note: "cold",
      star: 1,
    });

    assert.equal(crossOffResult.stderr, "");
    assert.deepEqual(parseJson(crossOffResult.stdout), {
      ok: true,
      operation: "cross_off_item",
      listId: "list-id",
      itemId: "item-id",
    });

    assert.equal(uncrossResult.stderr, "");
    assert.deepEqual(parseJson(uncrossResult.stdout), {
      ok: true,
      operation: "uncross_item",
      listId: "list-id",
      itemId: "item-id",
    });

    assert.deepEqual(client.calls, [
      { input: { listId: "list-id", value: "milk", note: "2%" }, method: "addItem" },
      { input: { listId: "list-id", itemId: "item-id" }, method: "removeItem" },
      {
        input: {
          listId: "list-id",
          itemId: "item-id",
          newValue: "whole milk",
          categoryId: null,
          note: "cold",
          star: 1,
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

test("get-crossed-off-items rejects conflicting sort flags", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await writeConfig(configPath, {
      authCookie: "config-auth-cookie-value",
      teamId: "config-team-id-value",
    });

    const env = {
      APPDATA: appData,
      HOME: home,
      USERPROFILE: home,
    };

    const conflictingFlagsResult = await runCli(
      ["get-crossed-off-items", "--list-id", "list-id", "--asc", "--desc"],
      env
    );

    assert.equal(conflictingFlagsResult.code, 1);
    assert.equal(conflictingFlagsResult.stdout, "");
    assert.match(conflictingFlagsResult.stderr, /at most one of --asc or --desc/);
  });
});

test("logout succeeds when no saved config file exists", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    const result = await runCli(["logout"], {
      APPDATA: appData,
      HOME: home,
      USERPROFILE: home,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /No saved credentials found at:/);
    assert.match(result.stdout, /Environment variables are not modified by logout/);
    await assert.rejects(fs.access(configPath), /ENOENT/);
  });
});
