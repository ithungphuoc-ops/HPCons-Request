import { describe, expect, it } from "vitest";
import { duocThuLai, SYNC_RETRY_MIN_INTERVAL_MS, trungKetQuaLanTruoc } from "./sync-retry-guard";

const NOW = Date.parse("2026-10-08T03:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("duocThuLai — tối đa 1 lần / 30 phút", () => {
  it("chưa từng thử / mốc hỏng → được thử", () => {
    expect(duocThuLai(undefined, NOW)).toBe(true);
    expect(duocThuLai(null, NOW)).toBe(true);
    expect(duocThuLai("không phải ngày", NOW)).toBe(true);
  });
  it("chưa đủ 30 phút → chưa; đủ → được", () => {
    expect(duocThuLai(iso(SYNC_RETRY_MIN_INTERVAL_MS - 1), NOW)).toBe(false);
    expect(duocThuLai(iso(SYNC_RETRY_MIN_INTERVAL_MS), NOW)).toBe(true);
  });
});

describe("trungKetQuaLanTruoc — không nối dòng nhật ký trùng", () => {
  const qlk = (a: string) => a.includes("QLK CTR");
  const history = [
    { at: iso(9000), actor: "Hệ thống", action: "QLK CTR CHƯA nhận — bỏ qua vì không khớp công trình", note: "N" },
    { at: iso(5000), actor: "Lê Minh", action: "Đã bình luận" },
  ];

  it("cùng hành động (bỏ hậu tố tự thử lại) + cùng ghi chú với dòng gần nhất của kênh → trùng", () => {
    expect(trungKetQuaLanTruoc(history, { action: "QLK CTR CHƯA nhận — bỏ qua vì không khớp công trình (tự thử lại)", note: "N" }, qlk)).toBe(true);
  });
  it("kết quả khác (đã đồng bộ được / ghi chú khác) → không trùng", () => {
    expect(trungKetQuaLanTruoc(history, { action: "Đã đồng bộ sang QLK CTR (tự thử lại)", note: "Công trình: AID" }, qlk)).toBe(false);
    expect(trungKetQuaLanTruoc(history, { action: "QLK CTR CHƯA nhận — bỏ qua vì không khớp công trình (tự thử lại)", note: "khác" }, qlk)).toBe(false);
  });
  it("chưa có dòng nào của kênh → không trùng", () => {
    expect(trungKetQuaLanTruoc([], { action: "Đồng bộ QLK CTR thất bại", note: "x" }, qlk)).toBe(false);
    expect(trungKetQuaLanTruoc(undefined, { action: "Đồng bộ QLK CTR thất bại", note: "x" }, qlk)).toBe(false);
  });
});
