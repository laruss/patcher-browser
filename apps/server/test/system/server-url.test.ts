import { describe, expect, it } from "vitest";
import { systemConfigResponseSchema } from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  type TestAppHarnessConfigOverrides,
  withTestHarness,
} from "../helpers/test-app.js";

async function readServerUrl(
  overrides: TestAppHarnessConfigOverrides,
  request: string,
  headers?: Record<string, string>,
): Promise<string> {
  return withTestHarness(overrides, async (harness) => {
    const response = await harness.app.request(request, { headers });
    const config = systemConfigResponseSchema.parse(await readJson(response));
    return config.serverUrl;
  });
}

describe("system config server URL", () => {
  it("prefers the configured app URL", async () => {
    expect(
      await readServerUrl(
        { appUrl: "https://patcher.example.test/" },
        "http://localhost:3334/api/v1/system/config",
      ),
    ).toBe("https://patcher.example.test");
  });

  it("uses the direct request origin when no app URL is configured", async () => {
    expect(
      await readServerUrl(
        { appUrl: undefined, isDevelopment: false },
        "http://patcher.lan:38986/api/v1/system/config",
      ),
    ).toBe("http://patcher.lan:38986");
  });

  it("maps the forwarded dev frontend origin onto the server port", async () => {
    expect(
      await readServerUrl(
        {
          appUrl: undefined,
          devAppPort: 12101,
          isDevelopment: true,
          serverPort: 20101,
        },
        "http://localhost:20101/api/v1/system/config",
        {
          "x-forwarded-host": "192.168.1.20:12101",
          "x-forwarded-proto": "http",
        },
      ),
    ).toBe("http://192.168.1.20:20101");
  });

  it("preserves a forwarded production origin", async () => {
    expect(
      await readServerUrl(
        { appUrl: undefined, isDevelopment: false },
        "http://127.0.0.1:38986/api/v1/system/config",
        {
          "x-forwarded-host": "patcher.example.test",
          "x-forwarded-proto": "https",
        },
      ),
    ).toBe("https://patcher.example.test");
  });
});
