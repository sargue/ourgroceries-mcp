import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

interface CliResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

interface TempCliHome {
  appData: string;
  configPath: string;
  home: string;
}

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

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

test("CLI reports the package version", async () => {
  const result = await runCli(["--version"], {});

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), await readPackageVersion());
});

test("logout removes the saved config file without modifying environment variables", async () => {
  await withTempCliHome(async ({ appData, configPath, home }) => {
    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ authCookie: "auth-cookie-value", teamId: "team-id-value" }),
      "utf-8"
    );

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
