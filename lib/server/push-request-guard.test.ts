import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { rejectUnlessJsonSameOrigin } = await import("./push-request-guard");

function req(headers: Record<string, string>) {
  return new Request("https://request.hpcore.vn/api/push/subscription", { method: "POST", headers, body: "{}" });
}

describe("rejectUnlessJsonSameOrigin — chặn gọi chéo trang", () => {
  it("JSON + Origin đúng app → cho qua", () => {
    expect(rejectUnlessJsonSameOrigin(req({ "content-type": "application/json", origin: "https://request.hpcore.vn" }))).toBeNull();
  });

  it("thiếu / sai Content-Type → 403", () => {
    expect(rejectUnlessJsonSameOrigin(req({ "content-type": "text/plain", origin: "https://request.hpcore.vn" }))?.status).toBe(403);
    expect(rejectUnlessJsonSameOrigin(req({ origin: "https://request.hpcore.vn" }))?.status).toBe(403);
  });

  it("Origin lạ (kể cả app khác cùng *.hpcore.vn) hoặc thiếu Origin → 403", () => {
    expect(rejectUnlessJsonSameOrigin(req({ "content-type": "application/json", origin: "https://evil.example" }))?.status).toBe(403);
    expect(rejectUnlessJsonSameOrigin(req({ "content-type": "application/json", origin: "https://kho.hpcore.vn" }))?.status).toBe(403);
    expect(rejectUnlessJsonSameOrigin(req({ "content-type": "application/json" }))?.status).toBe(403);
  });
});
