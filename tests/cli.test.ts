import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type {
  AddItemInput,
  OurGroceriesClientApi,
  RemoveItemInput,
  ToggleItemInput,
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
  | { input: ToggleItemInput; method: "toggleItem" };

const cliEnvNames = [
  "APPDATA",
  "HOME",
  "OURGROCERIES_AUTH_COOKIE",
  "OURGROCERIES_TEAM_ID",
  "USERPROFILE",
] as const;
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

class MockOurGroceriesClient implements OurGroceriesClientApi {
  calls: MockClientCall[] = [];
  getListsResult: unknown = {
    lists: [{ id: "list-id", name: "Groceries" }],
  };

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

  async toggleItem(input: ToggleItemInput): Promise<void> {
    this.calls.push({ input, method: "toggleItem" });
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

test("get-lists prints raw JSON and uses environment credentials when no config exists", async () => {
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
    assert.deepEqual(parseJson(result.stdout), {
      lists: [{ id: "list-id", name: "Groceries" }],
    });
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
    assert.deepEqual(parseJson(result.stdout), { lists: [] });
    assert.deepEqual(result.configs, [
      {
        authCookie: "config-auth-cookie-value",
        teamId: "config-team-id-value",
      },
    ]);
    assert.deepEqual(client.calls, [{ method: "getLists" }]);
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
    const toggleResult = await runCliProgram(
      ["toggle-item", "--list-id", "list-id", "--item-id", "item-id", "--crossed-off"],
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

    assert.equal(toggleResult.stderr, "");
    assert.deepEqual(parseJson(toggleResult.stdout), {
      ok: true,
      operation: "toggle_item",
      listId: "list-id",
      itemId: "item-id",
      crossedOff: true,
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
        input: { listId: "list-id", itemId: "item-id", crossedOff: true },
        method: "toggleItem",
      },
    ]);
  });
});

test("toggle-item rejects missing or conflicting toggle flags", async () => {
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

    const missingFlagResult = await runCli(
      ["toggle-item", "--list-id", "list-id", "--item-id", "item-id"],
      env
    );
    const conflictingFlagsResult = await runCli(
      [
        "toggle-item",
        "--list-id",
        "list-id",
        "--item-id",
        "item-id",
        "--crossed-off",
        "--uncrossed",
      ],
      env
    );

    assert.equal(missingFlagResult.code, 1);
    assert.equal(missingFlagResult.stdout, "");
    assert.match(missingFlagResult.stderr, /exactly one of --crossed-off or --uncrossed/);

    assert.equal(conflictingFlagsResult.code, 1);
    assert.equal(conflictingFlagsResult.stdout, "");
    assert.match(conflictingFlagsResult.stderr, /exactly one of --crossed-off or --uncrossed/);
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
