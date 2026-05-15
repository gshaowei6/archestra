import { readFile } from "node:fs/promises";
import config from "@/config";

const TOKEN_ENDPOINT_PATH = "/v1/oauth/token";
const GRANT_TYPE_JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;

type AnthropicWifConfig = typeof config.llm.anthropic.wif;

interface AnthropicWifTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

let cachedToken:
  | {
      token: string;
      expiresAtMs: number;
    }
  | undefined;

export function isAnthropicWifEnabled(): boolean {
  const wif = config.llm.anthropic.wif;

  return (
    wif.enabled &&
    Boolean(wif.federationRuleId) &&
    Boolean(wif.organizationId) &&
    Boolean(wif.serviceAccountId) &&
    hasIdentityTokenSource(wif)
  );
}

export async function getAnthropicWifAccessToken(): Promise<string> {
  const wif = getAnthropicWifConfigOrThrow();
  const now = Date.now();

  if (
    cachedToken &&
    cachedToken.expiresAtMs - ACCESS_TOKEN_EXPIRY_BUFFER_MS > now
  ) {
    return cachedToken.token;
  }

  const response = await fetch(buildTokenEndpointUrl(), {
    body: JSON.stringify({
      grant_type: GRANT_TYPE_JWT_BEARER,
      assertion: await readIdentityToken(wif),
      federation_rule_id: wif.federationRuleId,
      organization_id: wif.organizationId,
      service_account_id: wif.serviceAccountId,
      ...(wif.workspaceId ? { workspace_id: wif.workspaceId } : {}),
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Anthropic WIF token exchange failed: ${response.status} ${responseText}`,
    );
  }

  const tokenResponse = (await response.json()) as AnthropicWifTokenResponse;
  if (
    typeof tokenResponse.access_token !== "string" ||
    typeof tokenResponse.expires_in !== "number"
  ) {
    throw new Error(
      "Anthropic WIF token exchange returned an invalid response",
    );
  }

  cachedToken = {
    expiresAtMs: now + tokenResponse.expires_in * 1000,
    token: tokenResponse.access_token,
  };

  return cachedToken.token;
}

function getAnthropicWifConfigOrThrow(): AnthropicWifConfig {
  const wif = config.llm.anthropic.wif;
  const missing: string[] = [];

  if (!wif.enabled) {
    missing.push("ARCHESTRA_ANTHROPIC_WIF_ENABLED=true");
  }
  if (!wif.federationRuleId) {
    missing.push("ARCHESTRA_ANTHROPIC_FEDERATION_RULE_ID");
  }
  if (!wif.organizationId) {
    missing.push("ARCHESTRA_ANTHROPIC_ORGANIZATION_ID");
  }
  if (!wif.serviceAccountId) {
    missing.push("ARCHESTRA_ANTHROPIC_SERVICE_ACCOUNT_ID");
  }
  if (!hasIdentityTokenSource(wif)) {
    missing.push(
      "ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN_FILE or ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN",
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Anthropic WIF is not fully configured. Missing: ${missing.join(", ")}`,
    );
  }

  return wif;
}

function hasIdentityTokenSource(wif: AnthropicWifConfig): boolean {
  return Boolean(wif.identityToken || wif.identityTokenFile);
}

async function readIdentityToken(wif: AnthropicWifConfig): Promise<string> {
  if (wif.identityToken) {
    return wif.identityToken.trim();
  }

  if (wif.identityTokenFile) {
    return (await readFile(wif.identityTokenFile, "utf8")).trim();
  }

  throw new Error(
    "Anthropic WIF is not fully configured. Missing: ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN_FILE or ARCHESTRA_ANTHROPIC_IDENTITY_TOKEN",
  );
}

function buildTokenEndpointUrl(): string {
  return `${config.llm.anthropic.baseUrl.replace(/\/+$/, "")}${TOKEN_ENDPOINT_PATH}`;
}
