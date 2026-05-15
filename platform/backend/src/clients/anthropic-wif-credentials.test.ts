import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalEnv = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...originalEnv };

  for (const key of [
    "ARCHESTRA_ANTHROPIC_WIF_ENABLED",
    "ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID",
    "ARCHESTRA_ANTHROPIC_ORGANIZATION_ID",
    "ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID",
    "ARCHESTRA_ANTHROPIC_WORKSPACE_ID",
    "ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN",
    "ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN_FILE",
  ]) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("anthropic WIF credentials", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  test("is disabled until all required WIF settings and an identity token source are configured", async () => {
    resetEnv({
      ARCHESTRA_ANTHROPIC_WIF_ENABLED: "true",
      ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID: "fdrl_123",
      ARCHESTRA_ANTHROPIC_ORGANIZATION_ID: "org_123",
      ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_123",
    });

    const { isAnthropicWifEnabled } = await import(
      "./anthropic-wif-credentials"
    );

    expect(isAnthropicWifEnabled()).toBe(false);
  });

  test("is enabled when all required WIF settings are present", async () => {
    resetEnv({
      ARCHESTRA_ANTHROPIC_WIF_ENABLED: "true",
      ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID: "fdrl_123",
      ARCHESTRA_ANTHROPIC_ORGANIZATION_ID: "org_123",
      ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_123",
      ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN: "identity-jwt",
    });

    const { isAnthropicWifEnabled } = await import(
      "./anthropic-wif-credentials"
    );

    expect(isAnthropicWifEnabled()).toBe(true);
  });

  test("exchanges an identity token with Anthropic using the documented JSON payload and caches the access token", async () => {
    resetEnv({
      ARCHESTRA_ANTHROPIC_WIF_ENABLED: "true",
      ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID: "fdrl_123",
      ARCHESTRA_ANTHROPIC_ORGANIZATION_ID: "org_123",
      ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_123",
      ARCHESTRA_ANTHROPIC_WORKSPACE_ID: "wrkspc_123",
      ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN: "identity-jwt",
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );

    const { getAnthropicWifAccessToken } = await import(
      "./anthropic-wif-credentials"
    );

    await expect(getAnthropicWifAccessToken()).resolves.toBe("access-token");
    await expect(getAnthropicWifAccessToken()).resolves.toBe("access-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.anthropic.com/v1/oauth/token",
    );

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: "identity-jwt",
      federation_rule_id: "fdrl_123",
      organization_id: "org_123",
      service_account_id: "svac_123",
      workspace_id: "wrkspc_123",
    });
  });

  test("throws a configuration error before exchanging when a required setting is missing", async () => {
    resetEnv({
      ARCHESTRA_ANTHROPIC_WIF_ENABLED: "true",
      ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID: "fdrl_123",
      ARCHESTRA_ANTHROPIC_ORGANIZATION_ID: "org_123",
      ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN: "identity-jwt",
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { getAnthropicWifAccessToken } = await import(
      "./anthropic-wif-credentials"
    );

    await expect(getAnthropicWifAccessToken()).rejects.toThrow(
      "ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
