#!/usr/bin/env node

import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import prompts from "prompts";
import { login } from "./auth.js";
import { OurGroceriesClient } from "./client.js";
import type { OurGroceriesClientApi } from "./client.js";
import { saveConfig, getConfigPath, loadConfigResult, removeConfig } from "./config.js";
import type { Config, ConfigLoadResult } from "./config.js";
import {
  getActiveItems,
  getCategories,
  getCrossedOffItems,
  getListSummaries,
  getSettings,
  resolveItemToAdd,
} from "./data.js";
import type { CrossedOffItemsSortBy } from "./data.js";
import { VERSION } from "./version.js";

const envCredentialNames = ["OURGROCERIES_AUTH_COOKIE", "OURGROCERIES_TEAM_ID"] as const;

export interface CliProgramOptions {
  clientFactory?: (config: Config) => OurGroceriesClientApi;
  runServer?: (config: Config) => Promise<void>;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

interface CliRuntime {
  clientFactory: (config: Config) => OurGroceriesClientApi;
  runServer: (config: Config) => Promise<void>;
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

export function createProgram(options: CliProgramOptions = {}): Command {
  const runtime = createRuntime(options);
  const program = new Command();

  program.configureOutput({
    writeErr: runtime.stderr,
    writeOut: runtime.stdout,
  });
  program.name("ourgroceries-mcp").description("OurGroceries MCP server").version(VERSION);

  program
    .command("login")
    .description("Log in to OurGroceries and save credentials")
    .option("-e, --email <email>", "Email address")
    .option("-p, --password <password>", "Password")
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      try {
        console.log("OurGroceries Login\n");

        let email = options.email;
        let password = options.password;

        // If credentials not provided as arguments, prompt for them
        if (!email || !password) {
          const response = await prompts([
            {
              type: "text",
              name: "email",
              message: "Email:",
              initial: email,
              validate: (value) => (value.includes("@") ? true : "Please enter a valid email"),
            },
            {
              type: "password",
              name: "password",
              message: "Password:",
              validate: (value) => (value.length > 0 ? true : "Password cannot be empty"),
            },
          ]);

          // Check if user cancelled (Ctrl+C)
          if (!response.email || !response.password) {
            console.log("\nLogin cancelled");
            process.exit(0);
          }

          email = response.email;
          password = response.password;
        }

        console.log("\nAuthenticating...");

        const { authCookie, teamId } = await login(email, password, options.debug);

        await saveConfig({ authCookie, teamId });

        console.log(`\n✓ Successfully logged in!`);
        console.log(`\nCredentials saved to: ${getConfigPath()}`);
        console.log("\nYou can now use the OurGroceries MCP server without environment variables.");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`\n✗ Login failed: ${errorMessage}`);
        if (options.debug && error instanceof Error && error.stack) {
          console.error("\nStack trace:", error.stack);
        }
        process.exit(1);
      }
    });

  program
    .command("logout")
    .description("Remove saved OurGroceries credentials")
    .action(async () => {
      try {
        const removed = await removeConfig();

        if (removed) {
          console.log(`Removed saved credentials from: ${getConfigPath()}`);
        } else {
          console.log(`No saved credentials found at: ${getConfigPath()}`);
        }

        console.log("Environment variables are not modified by logout.");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`\n✗ Logout failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  program
    .command("get-lists")
    .description("Get visible shopping list summaries without item arrays")
    .action(async () => {
      await runOperationalCommand("get-lists", runtime, async (client) => {
        writeJson(runtime, getListSummaries(await client.getLists()));
      });
    });

  program
    .command("get-categories")
    .description("Get OurGroceries item categories")
    .action(async () => {
      await runOperationalCommand("get-categories", runtime, async (client) => {
        writeJson(runtime, getCategories(await client.getLists()));
      });
    });

  program
    .command("get-settings")
    .description("Get OurGroceries account settings")
    .action(async () => {
      await runOperationalCommand("get-settings", runtime, async (client) => {
        writeJson(runtime, getSettings(await client.getLists()));
      });
    });

  program
    .command("get-active-items")
    .description("Get active items from a shopping list")
    .requiredOption("--list-id <listId>", "The ID of the list to read")
    .action(async (options: GetActiveItemsOptions) => {
      await runOperationalCommand("get-active-items", runtime, async (client) => {
        writeJson(runtime, getActiveItems(await client.getLists(), options.listId));
      });
    });

  program
    .command("get-crossed-off-items")
    .description("Get crossed-off items from a shopping list")
    .requiredOption("--list-id <listId>", "The ID of the list to read")
    .option("--search <search>", "Case- and accent-insensitive search text")
    .option("--crossed-off-after <date>", "ISO date or epoch milliseconds lower bound")
    .option("--crossed-off-before <date>", "ISO date or epoch milliseconds upper bound")
    .option("--sort-by <sortBy>", "crossedOffAt or name", parseCrossedOffSortBy)
    .option("--asc", "Sort ascending")
    .option("--desc", "Sort descending")
    .option("--limit <limit>", "Maximum items to return", parseNonNegativeIntegerOption)
    .option("--offset <offset>", "Pagination offset", parseNonNegativeIntegerOption)
    .action(async (options: GetCrossedOffItemsOptions) => {
      const sortOrder = parseSortOrderOptions(
        "get-crossed-off-items",
        options.asc,
        options.desc,
        runtime
      );

      await runOperationalCommand("get-crossed-off-items", runtime, async (client) => {
        writeJson(
          runtime,
          getCrossedOffItems(await client.getLists(), {
            listId: options.listId,
            search: options.search,
            crossedOffAfter: options.crossedOffAfter,
            crossedOffBefore: options.crossedOffBefore,
            sortBy: options.sortBy,
            sortOrder,
            limit: options.limit,
            offset: options.offset,
          })
        );
      });
    });

  program
    .command("resolve-item-to-add")
    .description(
      "Resolve natural-language item text against the master catalog and shopping history"
    )
    .requiredOption("--query <query>", "The item text to resolve")
    .option("--list-id <listId>", "Optional target list ID")
    .option("--limit <limit>", "Maximum candidates to return", parseNonNegativeIntegerOption)
    .action(async (options: ResolveItemToAddOptions) => {
      await runOperationalCommand("resolve-item-to-add", runtime, async (client) => {
        writeJson(
          runtime,
          resolveItemToAdd(await client.getLists(), {
            query: options.query,
            listId: options.listId,
            limit: options.limit,
          })
        );
      });
    });

  program
    .command("add-item")
    .description("Add a new item to a grocery list")
    .requiredOption("--list-id <listId>", "The ID of the list to add the item to")
    .requiredOption("--value <value>", "The name/value of the item to add")
    .option("--note <note>", "Optional note for the item")
    .action(async (options: AddItemOptions) => {
      await runOperationalCommand("add-item", runtime, async (client) => {
        const note = options.note ?? "";

        await client.addItem({
          listId: options.listId,
          value: options.value,
          note,
        });

        writeJson(runtime, {
          ok: true,
          operation: "add_item",
          listId: options.listId,
          value: options.value,
          note,
        });
      });
    });

  program
    .command("remove-item")
    .description("Remove an item from a grocery list")
    .requiredOption("--list-id <listId>", "The ID of the list containing the item")
    .requiredOption("--item-id <itemId>", "The ID of the item to remove")
    .action(async (options: RemoveItemOptions) => {
      await runOperationalCommand("remove-item", runtime, async (client) => {
        await client.removeItem({
          listId: options.listId,
          itemId: options.itemId,
        });

        writeJson(runtime, {
          ok: true,
          operation: "remove_item",
          listId: options.listId,
          itemId: options.itemId,
        });
      });
    });

  program
    .command("update-item")
    .description("Update an item's details")
    .requiredOption("--list-id <listId>", "The ID of the list containing the item")
    .requiredOption("--item-id <itemId>", "The ID of the item to update")
    .requiredOption("--new-value <newValue>", "The new name/value for the item")
    .option("--category-id <categoryId>", "Optional category ID")
    .option("--note <note>", "Optional note")
    .option("--star <star>", "Star rating (0 or 1)", parseStarOption, 0)
    .action(async (options: UpdateItemOptions) => {
      await runOperationalCommand("update-item", runtime, async (client) => {
        const categoryId = options.categoryId ?? null;
        const note = options.note ?? "";
        const star = options.star ?? 0;

        await client.updateItem({
          listId: options.listId,
          itemId: options.itemId,
          newValue: options.newValue,
          categoryId,
          note,
          star,
        });

        writeJson(runtime, {
          ok: true,
          operation: "update_item",
          listId: options.listId,
          itemId: options.itemId,
          newValue: options.newValue,
          categoryId,
          note,
          star,
        });
      });
    });

  program
    .command("cross-off-item")
    .description("Mark an item as crossed off")
    .requiredOption("--list-id <listId>", "The ID of the list containing the item")
    .requiredOption("--item-id <itemId>", "The ID of the item to cross off")
    .action(async (options: CrossOffItemOptions) => {
      await runOperationalCommand("cross-off-item", runtime, async (client) => {
        await client.crossOffItem({
          listId: options.listId,
          itemId: options.itemId,
        });

        writeJson(runtime, {
          ok: true,
          operation: "cross_off_item",
          listId: options.listId,
          itemId: options.itemId,
        });
      });
    });

  program
    .command("uncross-item")
    .description("Mark an item as active again")
    .requiredOption("--list-id <listId>", "The ID of the list containing the item")
    .requiredOption("--item-id <itemId>", "The ID of the item to uncross")
    .action(async (options: CrossOffItemOptions) => {
      await runOperationalCommand("uncross-item", runtime, async (client) => {
        await client.uncrossItem({
          listId: options.listId,
          itemId: options.itemId,
        });

        writeJson(runtime, {
          ok: true,
          operation: "uncross_item",
          listId: options.listId,
          itemId: options.itemId,
        });
      });
    });

  // Default action (when no command specified) - start the server
  program.action(async () => {
    await runtime.runServer(await loadCredentials());
  });

  return program;
}

interface AddItemOptions {
  listId: string;
  note?: string;
  value: string;
}

interface GetActiveItemsOptions {
  listId: string;
}

interface GetCrossedOffItemsOptions {
  asc?: boolean;
  crossedOffAfter?: string;
  crossedOffBefore?: string;
  desc?: boolean;
  limit?: number;
  listId: string;
  offset?: number;
  search?: string;
  sortBy?: CrossedOffItemsSortBy;
}

interface ResolveItemToAddOptions {
  limit?: number;
  listId?: string;
  query: string;
}

interface RemoveItemOptions {
  itemId: string;
  listId: string;
}

interface UpdateItemOptions {
  categoryId?: string;
  itemId: string;
  listId: string;
  newValue: string;
  note?: string;
  star?: number;
}

interface CrossOffItemOptions {
  itemId: string;
  listId: string;
}

type EnvCredentialResult =
  | { config: Config; status: "loaded" }
  | { missingVars: Array<(typeof envCredentialNames)[number]>; status: "missing" };

async function runOperationalCommand(
  commandName: string,
  runtime: CliRuntime,
  run: (client: OurGroceriesClientApi) => Promise<void>
) {
  try {
    await run(runtime.clientFactory(await loadCredentials()));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runtime.stderr(`Error: ${commandName} failed: ${errorMessage}\n`);
    throw new CommanderError(1, `${commandName}.failed`, errorMessage);
  }
}

function createOurGroceriesClient(config: Config): OurGroceriesClientApi {
  return new OurGroceriesClient(config);
}

function createRuntime(options: CliProgramOptions): CliRuntime {
  return {
    clientFactory: options.clientFactory ?? createOurGroceriesClient,
    runServer: options.runServer ?? runMcpServer,
    stderr: options.stderr ?? ((message) => process.stderr.write(message)),
    stdout: options.stdout ?? ((message) => process.stdout.write(message)),
  };
}

async function runMcpServer(config: Config): Promise<void> {
  // Imported dynamically to avoid circular deps.
  const { OurGroceriesServer } = await import("./index.js");
  const server = new OurGroceriesServer(config);
  await server.run();
}

function parseStarOption(value: string): number {
  if (value !== "0" && value !== "1") {
    throw new InvalidArgumentError("must be 0 or 1");
  }

  return Number(value);
}

function parseCrossedOffSortBy(value: string): CrossedOffItemsSortBy {
  if (value !== "crossedOffAt" && value !== "name") {
    throw new InvalidArgumentError("must be crossedOffAt or name");
  }

  return value;
}

function parseNonNegativeIntegerOption(value: string): number {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }

  return parsedValue;
}

function parseSortOrderOptions(
  commandName: string,
  asc: boolean | undefined,
  desc: boolean | undefined,
  runtime: CliRuntime
): "asc" | "desc" | undefined {
  if (asc && desc) {
    const message = `${commandName} requires at most one of --asc or --desc`;
    runtime.stderr(`Error: ${message}\n`);
    throw new CommanderError(1, `${commandName}.invalidSortOrder`, message);
  }

  if (asc) {
    return "asc";
  }

  if (desc) {
    return "desc";
  }

  return undefined;
}

function writeJson(runtime: CliRuntime, value: unknown) {
  runtime.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

async function loadCredentials(): Promise<Config> {
  const configResult = await loadConfigResult();

  if (configResult.status === "loaded") {
    return configResult.config;
  }

  const envResult = loadCredentialsFromEnv();
  if (envResult.status === "loaded") {
    if (configResult.status === "invalid") {
      console.error(
        `Warning: Ignoring invalid config file at ${configResult.path}: ${configResult.reason}`
      );
    }

    return envResult.config;
  }

  printCredentialError(configResult, envResult);
  process.exit(1);
}

function loadCredentialsFromEnv(): EnvCredentialResult {
  const missingVars = envCredentialNames.filter((name) => !process.env[name]?.trim());

  if (missingVars.length > 0) {
    return { missingVars, status: "missing" };
  }

  return {
    config: {
      authCookie: process.env.OURGROCERIES_AUTH_COOKIE as string,
      teamId: process.env.OURGROCERIES_TEAM_ID as string,
    },
    status: "loaded",
  };
}

function printCredentialError(
  configResult: Exclude<ConfigLoadResult, { status: "loaded" }>,
  envResult: Extract<EnvCredentialResult, { status: "missing" }>
) {
  console.error("Error: No usable OurGroceries credentials found.\n");

  if (configResult.status === "invalid") {
    console.error(`Config file is invalid: ${configResult.path}`);
    console.error(`Reason: ${configResult.reason}\n`);
  } else {
    console.error(`No config file found at: ${configResult.path}\n`);
  }

  console.error("Environment-variable fallback is incomplete.");
  console.error("Missing:");
  for (const name of envResult.missingVars) {
    console.error(`  - ${name}`);
  }

  console.error("\nFix by running:");
  console.error("  npx ourgroceries-mcp login");
  console.error("\nOr set both environment variables:");
  for (const name of envCredentialNames) {
    console.error(`  - ${name}`);
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  const currentModule = fileURLToPath(import.meta.url);

  try {
    return realpathSync(entryPoint) === realpathSync(currentModule);
  } catch {
    return entryPoint === currentModule;
  }
}

function handleTopLevelCliError(error: unknown): never {
  if (error instanceof CommanderError) {
    process.exit(error.exitCode);
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${errorMessage}`);
  process.exit(1);
}

if (isMainModule()) {
  await createProgram().parseAsync().catch(handleTopLevelCliError);
}
