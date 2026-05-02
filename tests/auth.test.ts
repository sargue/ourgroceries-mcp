import assert from "node:assert/strict";
import test from "node:test";

import { login } from "../src/auth.js";

const signInUrl = "https://www.ourgroceries.com/sign-in";
const yourListsUrl = "https://www.ourgroceries.com/your-lists/";

interface FetchCall {
  init: RequestInit | undefined;
  input: Parameters<typeof fetch>[0];
}

interface MockResponseOptions {
  ok?: boolean;
  setCookieHeader?: string | null;
  setCookieHeaders?: string[];
  status?: number;
  statusText?: string;
  text?: string;
}

interface MockHeaders {
  entries(): IterableIterator<[string, string]>;
  get(name: string): string | null;
  getSetCookie?: () => string[];
}

async function withMockedFetch(responses: Response[], run: (calls: FetchCall[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const pendingResponses = [...responses];
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ init, input });

    const response = pendingResponses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch call to ${String(input)}`);
    }

    return response;
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createResponse({
  ok,
  setCookieHeader = null,
  setCookieHeaders = [],
  status = 200,
  statusText = "OK",
  text = "",
}: MockResponseOptions = {}): Response {
  const headerEntries: [string, string][] =
    setCookieHeader === null ? [] : [["set-cookie", setCookieHeader]];
  const headers: MockHeaders = {
    get(name: string) {
      return name.toLowerCase() === "set-cookie" ? setCookieHeader : null;
    },
    *entries() {
      yield* headerEntries;
    },
  };

  if (setCookieHeaders.length > 0) {
    headers.getSetCookie = () => [...setCookieHeaders];
  }

  return {
    headers,
    json: async () => JSON.parse(text) as unknown,
    ok: ok ?? (status >= 200 && status < 300),
    status,
    statusText,
    text: async () => text,
  } as unknown as Response;
}

function getHeaders(init: RequestInit | undefined): Record<string, string> {
  assert.ok(init?.headers);
  assert.equal(Array.isArray(init.headers), false);
  assert.equal(init.headers instanceof Headers, false);

  return init.headers as Record<string, string>;
}

test("login extracts the auth cookie from getSetCookie and parses the team ID", async () => {
  await withMockedFetch(
    [
      createResponse({
        setCookieHeaders: [
          "session=ignored; Path=/",
          "ourgroceries-auth=auth-token-value; Path=/; HttpOnly",
        ],
      }),
      createResponse({
        text: '<script>window.app = true; g_teamId = "team-id-value";</script>',
      }),
    ],
    async (calls) => {
      const result = await login("person@example.com", "secret-password");

      assert.deepEqual(result, {
        authCookie: "auth-token-value",
        teamId: "team-id-value",
      });

      assert.equal(calls.length, 2);
      assert.equal(String(calls[0].input), signInUrl);
      assert.equal(calls[0].init?.method, "POST");
      assert.equal(calls[0].init?.redirect, "manual");
      assert.equal(getHeaders(calls[0].init)["Content-Type"], "application/x-www-form-urlencoded");

      const signInBody = calls[0].init?.body;
      if (typeof signInBody !== "string") {
        assert.fail("Expected sign-in body to be a string");
      }

      const body = new URLSearchParams(signInBody);
      assert.equal(body.get("emailAddress"), "person@example.com");
      assert.equal(body.get("password"), "secret-password");
      assert.equal(body.get("action"), "sign-in");

      assert.equal(String(calls[1].input), yourListsUrl);
      assert.equal(getHeaders(calls[1].init).Cookie, "ourgroceries-auth=auth-token-value");
    }
  );
});

test("login falls back to the set-cookie header when getSetCookie is unavailable", async () => {
  await withMockedFetch(
    [
      createResponse({
        setCookieHeader: "ourgroceries-auth=fallback-token-value; Path=/; HttpOnly",
      }),
      createResponse({
        text: 'g_teamId = "fallback-team-id";',
      }),
    ],
    async () => {
      assert.deepEqual(await login("person@example.com", "secret-password"), {
        authCookie: "fallback-token-value",
        teamId: "fallback-team-id",
      });
    }
  );
});

test("login rejects responses without an auth cookie", async () => {
  await assert.rejects(
    withMockedFetch(
      [
        createResponse({
          setCookieHeaders: ["session=not-the-auth-cookie; Path=/"],
        }),
      ],
      async () => {
        await login("person@example.com", "secret-password");
      }
    ),
    /Auth cookie not found/
  );
});

test("login rejects lists pages without a team ID", async () => {
  await assert.rejects(
    withMockedFetch(
      [
        createResponse({
          setCookieHeaders: ["ourgroceries-auth=auth-token-value; Path=/; HttpOnly"],
        }),
        createResponse({
          text: "<html><body>No team identifier here</body></html>",
        }),
      ],
      async () => {
        await login("person@example.com", "secret-password");
      }
    ),
    /Could not extract team ID/
  );
});
