import { describe, expect, it } from "vitest";
import { buildUploadPath, isOwnUploadPath } from "./uploads";
import { isFreshOwnUploadPath } from "./decision-attachments";

describe("buildUploadPath — không trùng path khi ký nhiều tệp cùng lúc", () => {
  it("2 tệp tên ngoài ASCII cùng ms → path khác nhau", () => {
    const a = buildUploadPath("uA", "Ảnh.jpg", 1791253410818);
    const b = buildUploadPath("uA", "Ẩnh.jpg", 1791253410818);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^requests\/uA\/1791253410818-[a-z0-9]{8}-_nh\.jpg$/);
  });

  it("path mới vẫn qua isOwnUploadPath + kiểm tệp quyết định; path cũ (không phần ngẫu nhiên) vẫn hợp lệ", () => {
    const now = Date.now();
    const p = buildUploadPath("uA", "Biên bản.pdf", now - 1000);
    expect(isOwnUploadPath(p, "uA")).toBe(true);
    expect(isFreshOwnUploadPath(p, "uA", now)).toBe(true);
    expect(isFreshOwnUploadPath(`requests/uA/${now - 1000}-Bi_n_b_n.pdf`, "uA", now)).toBe(true);
  });
});

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
