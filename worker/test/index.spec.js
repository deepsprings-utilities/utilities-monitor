import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index.js";

describe("acquisuite-ingest worker", () => {
  it("GET returns SUCCESS - OK", async () => {
    const request = new Request("http://example.com/", { method: "GET" });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("SUCCESS");
  });
});
