import { describe, expect, it } from "vitest";
import { shortenCustomerName } from "./customer-name";

describe("shortenCustomerName", () => {
  it("bỏ 'CÔNG TY TNHH' + mô tả ngành nghề chung chung, giữ đúng thương hiệu", () => {
    expect(shortenCustomerName("CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI")).toBe("CHENKAI");
  });

  it("bỏ hậu tố 'VIỆT NAM', KHÔNG đụng vào từ tiếng Anh là 1 phần thương hiệu", () => {
    expect(shortenCustomerName("CÔNG TY TNHH GIANT MANUFACTURING VIỆT NAM")).toBe("GIANT MANUFACTURING");
  });

  it("không cắt nhầm từ thương hiệu chứa chuỗi con trùng hậu tố quốc gia (VIETNAMTEX)", () => {
    expect(shortenCustomerName("CÔNG TY TNHH GOLDEN VIETNAMTEX")).toBe("GOLDEN VIETNAMTEX");
  });

  it("hỗ trợ loại hình 'CỔ PHẦN'", () => {
    expect(shortenCustomerName("CÔNG TY CỔ PHẦN SẢN XUẤT THƯƠNG MẠI RUN YAO")).toBe("RUN YAO");
  });

  it("tên đã ngắn sẵn (không có từ pháp nhân/mô tả) thì giữ nguyên", () => {
    expect(shortenCustomerName("SHUN HING")).toBe("SHUN HING");
  });

  it("nếu lọc hết sạch từ (toàn từ pháp nhân) thì trả lại nguyên chuỗi gốc thay vì rỗng", () => {
    expect(shortenCustomerName("CÔNG TY TNHH")).toBe("CÔNG TY TNHH");
  });

  it("chuỗi rỗng trả về rỗng", () => {
    expect(shortenCustomerName("")).toBe("");
  });

  // 11 tên CĐT thật (đọc trực tiếp Firestore project "hpcons-congno",
  // collection "contracts", 26/09/2026 — 20 hợp đồng, 11 tên khác nhau) —
  // khoá lại đúng bảng đối chiếu để không tái diễn lỗi hậu tố "(VIETNAM)".
  it.each([
    ["CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI", "CHENKAI"],
    ["CÔNG TY TNHH CƠ KHÍ JIANGDONG (VIETNAM)", "JIANGDONG"],
    ["CÔNG TY TNHH GIANT MANUFACTURING VIỆT NAM", "GIANT MANUFACTURING"],
    ["CÔNG TY TNHH GOLDEN VIETNAMTEX", "GOLDEN VIETNAMTEX"],
    ["CÔNG TY TNHH HOWELL TECHNOLOGY (VIET NAM)", "HOWELL TECHNOLOGY"],
    ["CÔNG TY TNHH MỘT THÀNH VIÊN CHIEN YI", "CHIEN YI"],
    ["CÔNG TY TNHH MTV RUN YAO", "RUN YAO"],
    ["CÔNG TY TNHH RTI (VIỆT NAM)", "RTI"],
    ["CÔNG TY TNHH SHUN HING (VIETNAM)", "SHUN HING"],
    ["CÔNG TY TNHH TSWEN HOEI VIỆT NAM", "TSWEN HOEI"],
    ["HP CONS", "HP CONS"],
  ])("dữ liệu thật: %s -> %s", (full, short) => {
    expect(shortenCustomerName(full)).toBe(short);
  });
});
