import { promises as fs } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

export interface Config {
  authCookie: string;
  teamId: string;
}

export type ConfigLoadResult =
  | { config: Config; path: string; status: "loaded" }
  | { path: string; status: "missing" }
  | { path: string; reason: string; status: "invalid" };

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
  const result = await loadConfigResult();

  return result.status === "loaded" ? result.config : null;
}

export async function loadConfigResult(): Promise<ConfigLoadResult> {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = parseConfig(JSON.parse(content));

    return { config, path: configPath, status: "loaded" };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { path: configPath, status: "missing" };
    }

    if (error instanceof SyntaxError) {
      return { path: configPath, reason: "file is not valid JSON", status: "invalid" };
    }

    if (error instanceof ConfigValidationError) {
      return { path: configPath, reason: error.message, status: "invalid" };
    }

    const reason =
      error instanceof Error
        ? `could not read config file: ${error.message}`
        : "could not read config file";
    return { path: configPath, reason, status: "invalid" };
  }
}

export async function removeConfig(): Promise<boolean> {
  const configPath = getConfigPath();

  try {
    await fs.unlink(configPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object") {
    throw new ConfigValidationError("file must contain a JSON object");
  }

  const config = value as Partial<Record<keyof Config, unknown>>;

  if (typeof config.authCookie !== "string" || config.authCookie.trim().length === 0) {
    throw new ConfigValidationError("authCookie must be a non-empty string");
  }

  if (typeof config.teamId !== "string" || config.teamId.trim().length === 0) {
    throw new ConfigValidationError("teamId must be a non-empty string");
  }

  return {
    authCookie: config.authCookie,
    teamId: config.teamId,
  };
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
