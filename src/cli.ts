#!/usr/bin/env node

import { Command } from "commander";
import prompts from "prompts";
import { login } from "./auth.js";
import { saveConfig, getConfigPath, loadConfigResult, removeConfig } from "./config.js";
import type { Config, ConfigLoadResult } from "./config.js";

const program = new Command();
const envCredentialNames = ["OURGROCERIES_AUTH_COOKIE", "OURGROCERIES_TEAM_ID"] as const;

program.name("ourgroceries-mcp").description("OurGroceries MCP server").version("1.0.0");

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

// Default action (when no command specified) - start the server
program.action(async () => {
  const config = await loadCredentials();

  // Start the server (imported dynamically to avoid circular deps)
  const { OurGroceriesServer } = await import("./index.js");
  const server = new OurGroceriesServer(config);
  await server.run();
});

program.parse();

type EnvCredentialResult =
  | { config: Config; status: "loaded" }
  | { missingVars: Array<(typeof envCredentialNames)[number]>; status: "missing" };

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
