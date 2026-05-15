import type AnthropicProvider from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/observability", () => ({
  metrics: { llm: { getObservableFetch: vi.fn() } },
}));

vi.mock("@/clients/azure-openai-credentials", () => ({
  getAzureAiFoundryBearerTokenProvider: vi.fn(),
  isAnthropicAzureFoundryEntraIdEnabled: vi.fn(() => false),
}));

vi.mock("@/clients/anthropic-wif-credentials", () => ({
  getAnthropicWifAccessToken: vi.fn(async () => "wif-access-token"),
  isAnthropicWifEnabled: vi.fn(() => true),
}));

import { getAnthropicWifAccessToken } from "@/clients/anthropic-wif-credentials";
import { anthropicAdapterFactory } from "./anthropic";

describe("anthropicAdapterFactory WIF", () => {
  test("creates a keyless client that injects a fresh WIF bearer token", async () => {
    const client = anthropicAdapterFactory.createClient(undefined, {
      baseUrl: "https://api.anthropic.com",
      defaultHeaders: {},
      source: "api",
    }) as AnthropicProvider & {
      _options?: {
        defaultHeaders?: Record<string, string>;
        fetch?: typeof globalThis.fetch;
      };
    };

    expect(client._options?.defaultHeaders?.Authorization).toBe(
      "Bearer <wif-managed>",
    );

    const fetch = client._options?.fetch;
    expect(fetch).toBeDefined();

    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    await fetch?.("https://api.anthropic.com/v1/messages", {
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(getAnthropicWifAccessToken).toHaveBeenCalledOnce();

    const headers = new Headers(upstreamFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer wif-access-token");

    upstreamFetch.mockRestore();
  });
});
