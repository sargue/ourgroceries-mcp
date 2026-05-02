import { promises as fs } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

export interface Config {
  authCookie: string;
  teamId: string;
}

export function getConfigPath(): string {
  const homeDir = homedir();

  // Platform-specific config directory
  if (process.platform === "win32") {
    // Windows: %APPDATA%\ourgroceries-mcp\config.json
    const appData = process.env.APPDATA || join(homeDir, "AppData", "Roaming");
    return join(appData, "ourgroceries-mcp", "config.json");
  } else {
    // macOS/Linux: ~/.config/ourgroceries-mcp/config.json
    return join(homeDir, ".config", "ourgroceries-mcp", "config.json");
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  // Create directory if it doesn't exist
  await fs.mkdir(configDir, { recursive: true });

  // Write config file
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

  // Set file permissions to 0600 (owner read/write only) on Unix-like systems
  if (process.platform !== "win32") {
    await fs.chmod(configPath, 0o600);
  }
}

export async function loadConfig(): Promise<Config | null> {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content) as Config;

    // Validate that required fields exist
    if (!config.authCookie || !config.teamId) {
      return null;
    }

    return config;
  } catch {
    // File doesn't exist or is invalid
    return null;
  }
}
