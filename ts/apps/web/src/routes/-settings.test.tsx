import { describe, expect, it } from "vite-plus/test";

import { endpointFormIssues } from "#/routes/settings";

describe("/settings endpoint form", () => {
  it("refuses before any request", () => {
    expect(endpointFormIssues("not a url", "k")).toEqual({ baseUrl: "not a URL" });
    expect(endpointFormIssues("ftp://x/v1", "k").baseUrl).toBe(
      "scheme must be http or https, got ftp:",
    );
    expect(endpointFormIssues("http://x/v1", "").apiKey).toBe("required");
    expect(endpointFormIssues("http://x/v1", "a b").apiKey).toBe("must not contain whitespace");
  });
  it("admits a parseable http(s) URL and a solid key", () => {
    expect(endpointFormIssues("https://api.example.com/v1", "sk-abc")).toEqual({});
  });
});
