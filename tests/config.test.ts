import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  getConfigPath,
  loadConfig,
  loadConfigResult,
  removeConfig,
  saveConfig,
} from "../src/config.js";
import type { Config } from "../src/config.js";

interface TempConfigHome {
  appData: string;
  home: string;
}

async function withTempConfigHome(run: (tempConfigHome: TempConfigHome) => Promise<void>) {
  const originalEnv = {
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  const home = await fs.mkdtemp(join(tmpdir(), "ourgroceries-mcp-config-"));
  const appData = join(home, "AppData", "Roaming");

  process.env.APPDATA = appData;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  try {
    await run({ appData, home });
  } finally {
    restoreEnvValue("APPDATA", originalEnv.APPDATA);
    restoreEnvValue("HOME", originalEnv.HOME);
    restoreEnvValue("USERPROFILE", originalEnv.USERPROFILE);
    await fs.rm(home, { force: true, recursive: true });
  }
}

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

test("getConfigPath resolves inside the configured user config directory", async () => {
  await withTempConfigHome(async ({ appData, home }) => {
    const expectedBaseDir = process.platform === "win32" ? appData : join(home, ".config");

    assert.equal(getConfigPath(), join(expectedBaseDir, "ourgroceries-mcp", "config.json"));
  });
});

test("saveConfig creates a private config file that loadConfig can read", async () => {
  await withTempConfigHome(async () => {
    const config: Config = {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    };

    await saveConfig(config);

    assert.deepEqual(await loadConfig(), config);

    if (process.platform !== "win32") {
      const stat = await fs.stat(getConfigPath());
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });
});

test("loadConfig returns null for missing, malformed, or incomplete config", async () => {
  await withTempConfigHome(async () => {
    const configPath = getConfigPath();

    assert.equal(await loadConfig(), null);

    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{not-json", "utf-8");

    assert.equal(await loadConfig(), null);

    await fs.writeFile(configPath, JSON.stringify({ authCookie: "auth-cookie-value" }), "utf-8");

    assert.equal(await loadConfig(), null);
  });
});

test("loadConfigResult reports why a config file is invalid", async () => {
  await withTempConfigHome(async () => {
    const configPath = getConfigPath();

    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{not-json", "utf-8");

    assert.deepEqual(await loadConfigResult(), {
      path: configPath,
      reason: "file is not valid JSON",
      status: "invalid",
    });

    await fs.writeFile(configPath, JSON.stringify({ authCookie: "auth-cookie-value" }), "utf-8");

    assert.deepEqual(await loadConfigResult(), {
      path: configPath,
      reason: "teamId must be a non-empty string",
      status: "invalid",
    });
  });
});

test("removeConfig deletes saved credentials without failing when none exist", async () => {
  await withTempConfigHome(async () => {
    const config: Config = {
      authCookie: "auth-cookie-value",
      teamId: "team-id-value",
    };

    assert.equal(await removeConfig(), false);

    await saveConfig(config);
    assert.deepEqual(await loadConfig(), config);

    assert.equal(await removeConfig(), true);
    assert.equal(await loadConfig(), null);
    assert.equal(await removeConfig(), false);
  });
});
