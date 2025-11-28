#!/usr/bin/env node

import { Command } from "commander";
import prompts from "prompts";
import { login } from "./auth.js";
import { saveConfig, getConfigPath, loadConfig } from "./config.js";
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

async function startServer(config: OurGroceriesConfig) {
  const { OurGroceriesServer } = await import("./index.js");
  const server = new OurGroceriesServer(config);
  await server.run();
}

const program = new Command();

program
  .name("ourgroceries-mcp")
  .description("OurGroceries MCP server")
  .version("1.0.0");

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
            validate: (value) =>
              value.includes("@") ? true : "Please enter a valid email",
          },
          {
            type: "password",
            name: "password",
            message: "Password:",
            validate: (value) =>
              value.length > 0 ? true : "Password cannot be empty",
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

      const { authCookie, teamId } = await login(
        email,
        password,
        options.debug
      );

      await saveConfig({ authCookie, teamId });

      console.log(`\n✓ Successfully logged in!`);
      console.log(`\nCredentials saved to: ${getConfigPath()}`);
      console.log(
        "\nYou can now use the OurGroceries MCP server without environment variables."
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n✗ Login failed: ${errorMessage}`);
      if (options.debug && error instanceof Error && error.stack) {
        console.error("\nStack trace:", error.stack);
      }
      process.exit(1);
    }
  });

// Default action (when no command specified) - start the server
program.action(async () => {
  // Try to load config from file first
  let config = await loadConfig();

  // Fall back to environment variables if config file doesn't exist
  if (!config) {
    const authCookie = process.env.OURGROCERIES_AUTH_COOKIE;
    const teamId = process.env.OURGROCERIES_TEAM_ID;

    if (authCookie && teamId) {
      config = { authCookie, teamId };
    }
  }

  // If no config found, provide helpful error message
  if (!config) {
    console.error("Error: No OurGroceries credentials found.\n");
    console.error("Please run: npx ourgroceries-mcp login\n");
    console.error("Or set environment variables:");
    console.error("  - OURGROCERIES_AUTH_COOKIE");
    console.error("  - OURGROCERIES_TEAM_ID\n");
    console.error(`Config file location: ${getConfigPath()}`);
    process.exit(1);
  }

  // Start the server (imported dynamically to avoid circular deps)
  const { OurGroceriesServer } = await import("./index.js");
  const server = new OurGroceriesServer(config);
  await server.run();
});

program.parse();
