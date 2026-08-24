import { describe, expect, it } from "vitest";
import { isOwnUploadPath } from "./uploads";

describe("isOwnUploadPath — chặn path 'vay mượn' khi thêm tài liệu đính kèm", () => {
  it("path đúng do chính người gọi tải lên (đúng namespace requests/{uid}/...) → hợp lệ", () => {
    expect(isOwnUploadPath("requests/uA/1700000000000-bao_cao.pdf", "uA")).toBe(true);
  });

  it("path của NGƯỜI KHÁC tải lên → bị chặn", () => {
    expect(isOwnUploadPath("requests/uB/1700000000000-bao_cao.pdf", "uA")).toBe(false);
  });

  it("path mẫu in (print-templates) — không thuộc namespace upload → bị chặn", () => {
    expect(isOwnUploadPath("print-templates/g1/mau-in.docx", "uA")).toBe(false);
  });

  it("path rỗng hoặc namespace lạ → bị chặn", () => {
    expect(isOwnUploadPath("", "uA")).toBe(false);
    expect(isOwnUploadPath("something-else/uA/file.pdf", "uA")).toBe(false);
  });

  it("chỉ khớp khi ĐÚNG uid làm tiền tố — 'uA2' không được coi là con của 'uA'", () => {
    expect(isOwnUploadPath("requests/uA2/file.pdf", "uA")).toBe(false);
  });
});
