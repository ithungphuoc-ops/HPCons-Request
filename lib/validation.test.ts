import { describe, expect, it } from "vitest";
import {
  nextCounterCode,
  sanitizeDescriptionHtml,
  validateFieldCodeUnique,
  validateFieldName,
  validateFieldOptions,
  validateGroupName,
  validatePermissionSelection,
  validateSlaHours,
} from "./validation";

describe("nextCounterCode", () => {
  it("bắt đầu từ 000000001 khi chưa có giá trị hiện tại", () => {
    expect(nextCounterCode(undefined)).toEqual({ next: 2, code: "000000001" });
  });

  it("tăng dần và giữ định dạng 9 chữ số (Sếp chốt 17/08/2026)", () => {
    expect(nextCounterCode(1)).toEqual({ next: 2, code: "000000001" });
    expect(nextCounterCode(41)).toEqual({ next: 42, code: "000000041" });
  });

  it("2 lần gọi liên tiếp (mô phỏng gửi đồng thời) cho ra mã khác nhau", () => {
    const first = nextCounterCode(undefined);
    const second = nextCounterCode(first.next);
    expect(first.code).not.toBe(second.code);
  });

  it("vượt quá 999999999 vẫn hiện đủ số, không lỗi", () => {
    expect(nextCounterCode(999999999).code).toBe("999999999");
    expect(nextCounterCode(1000000000).code).toBe("1000000000");
  });
});

describe("sanitizeDescriptionHtml", () => {
  it("giữ nguyên các thẻ trong bộ toolbar cho phép", () => {
    const html = "<p><b>Đậm</b> <i>nghiêng</i></p><ul><li>Mục 1</li></ul>";
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it("loại bỏ thẻ script", () => {
    const result = sanitizeDescriptionHtml('<p>Chào</p><script>alert("x")</script>');
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("loại bỏ thuộc tính onerror", () => {
    const result = sanitizeDescriptionHtml('<img src="x.png" onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  it("loại bỏ liên kết javascript:", () => {
    const result = sanitizeDescriptionHtml('<a href="javascript:alert(1)">Bấm</a>');
    expect(result).not.toContain("javascript:");
  });

  it("loại bỏ thẻ không nằm trong allowlist (vd iframe)", () => {
    const result = sanitizeDescriptionHtml('<iframe src="https://evil.example"></iframe><p>Ok</p>');
    expect(result).not.toContain("<iframe");
    expect(result).toContain("<p>Ok</p>");
  });
});

describe("validateGroupName", () => {
  it("báo lỗi khi tên trống", () => {
    expect(validateGroupName("").valid).toBe(false);
    expect(validateGroupName("   ").valid).toBe(false);
  });

  it("hợp lệ khi có tên", () => {
    expect(validateGroupName("Đề xuất xin nghỉ phép").valid).toBe(true);
  });
});

describe("validateSlaHours", () => {
  it("cho phép để trống", () => {
    expect(validateSlaHours(null).valid).toBe(true);
  });

  it("từ chối số âm", () => {
    expect(validateSlaHours(-5).valid).toBe(false);
  });

  it("chấp nhận số không âm", () => {
    expect(validateSlaHours(0).valid).toBe(true);
    expect(validateSlaHours(24).valid).toBe(true);
  });
});

describe("validateFieldName", () => {
  it("báo lỗi khi tên trường trống", () => {
    expect(validateFieldName("").valid).toBe(false);
  });

  it("hợp lệ khi có tên", () => {
    expect(validateFieldName("Số điện thoại").valid).toBe(true);
  });
});

describe("validateFieldOptions", () => {
  it("yêu cầu ít nhất một phương án cho kiểu một lựa chọn", () => {
    expect(validateFieldOptions("single_choice", []).valid).toBe(false);
    expect(validateFieldOptions("single_choice", ["  "]).valid).toBe(false);
    expect(validateFieldOptions("single_choice", ["Có"]).valid).toBe(true);
  });

  it("yêu cầu ít nhất một phương án cho kiểu nhiều lựa chọn", () => {
    expect(validateFieldOptions("multiple_choice", []).valid).toBe(false);
    expect(validateFieldOptions("multiple_choice", ["A", "B"]).valid).toBe(true);
  });

  it("không áp dụng cho các kiểu dữ liệu khác", () => {
    expect(validateFieldOptions("short_text", []).valid).toBe(true);
  });
});

describe("validateFieldCodeUnique", () => {
  it("báo lỗi khi mã trường đã tồn tại", () => {
    expect(validateFieldCodeUnique(["ten", "email"], "email").valid).toBe(false);
  });

  it("hợp lệ khi mã trường chưa tồn tại", () => {
    expect(validateFieldCodeUnique(["ten", "email"], "so_dien_thoai").valid).toBe(true);
  });
});

describe("validatePermissionSelection", () => {
  it("báo lỗi khi chưa chọn quyền nào", () => {
    expect(validatePermissionSelection([]).valid).toBe(false);
  });

  it("hợp lệ khi đã chọn ít nhất một quyền", () => {
    expect(validatePermissionSelection(["request.admin"]).valid).toBe(true);
  });
});
