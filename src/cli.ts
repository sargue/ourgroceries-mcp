#!/usr/bin/env node

import { Command } from "commander";
import prompts from "prompts";
import { login } from "./auth.js";
import { saveConfig, getConfigPath } from "./config.js";

const program = new Command();

program
  .name("ourgroceries-mcp")
  .description("OurGroceries MCP server CLI")
  .version("1.0.0");

program
  .command("login")
  .description("Log in to OurGroceries and save credentials")
  .action(async () => {
    try {
      console.log("OurGroceries Login\n");

      const response = await prompts([
        {
          type: "text",
          name: "email",
          message: "Email:",
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

      console.log("\nAuthenticating...");

      const { authCookie, teamId } = await login(
        response.email,
        response.password
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
      process.exit(1);
    }
  });

program.parse();
