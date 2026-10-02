import { describe, expect, it } from "vitest";
import { anchorBox, colName, dibToBmp, excelGeometry, walkPx } from "./excel-geometry";

describe("colName", () => {
  it("đặt tên cột như Excel", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("excelGeometry", () => {
  it("đổi độ rộng cột/chiều cao dòng theo đúng Excel (7px mỗi ký tự, 4/3 px mỗi pt)", () => {
    const g = excelGeometry({ "!cols": [{ width: 6.77734375 }, { wch: 22.22 }, undefined, { width: 10, hidden: true }], "!rows": [{ hpt: 30 }, undefined, { hpt: 15, hidden: true }] });
    expect(g.colW(0)).toBe(47);
    expect(g.colW(1)).toBe(161);
    expect(g.colW(2)).toBe(64); // cột không khai báo = mặc định
    expect(g.colW(3)).toBe(0); // cột ẩn
    expect(g.rowH(0)).toBe(40);
    expect(g.rowH(1)).toBe(20); // dòng mặc định 15pt
    expect(g.rowH(2)).toBe(0); // dòng ẩn
  });
});

describe("walkPx", () => {
  const size = () => 64;
  it("đi qua nhiều ô và trả phần lẻ trong ô dừng", () => {
    expect(walkPx(0, 0, size)).toEqual({ i: 0, f: 0 });
    expect(walkPx(0, 32, size)).toEqual({ i: 0, f: 0.5 });
    expect(walkPx(0, 160, size)).toEqual({ i: 2, f: 0.5 });
    expect(walkPx(3, 64, size)).toEqual({ i: 4, f: 0 });
  });
  it("không lặp vô hạn khi gặp cột ẩn (độ rộng 0)", () => {
    expect(walkPx(0, 500, (i) => (i < 2 ? 64 : 0))).toEqual({ i: 2, f: 0 });
  });
});

describe("anchorBox", () => {
  const g = excelGeometry({});
  it("neo .xls (ô + phần lẻ) giữ nguyên", () => {
    const box = anchorBox({ from: { c: 9, fx: 0, r: 4, fy: 0.5 }, to: { c: 14, fx: 0.25, r: 14, fy: 0 } }, g);
    expect(box).toEqual({ a: { c: 9, fx: 0, r: 4, fy: 0.5 }, b: { c: 14, fx: 0.25, r: 14, fy: 0 } });
  });
  it("neo .xlsx (ô + lề px) đổi thành ô + phần lẻ, lề vượt ô thì sang ô kế", () => {
    const box = anchorBox({ from: { c: 0, r: 0, ox: 32, oy: 10 }, to: { c: 2, r: 3, ox: 80, oy: 0 } }, g);
    expect(box).toEqual({ a: { c: 0, fx: 0.5, r: 0, fy: 0.5 }, b: { c: 3, fx: 0.25, r: 3, fy: 0 } });
  });
  it("neo 1 góc + kích thước (oneCellAnchor) tính ra góc dưới-phải", () => {
    const box = anchorBox({ from: { c: 1, r: 1, ox: 0, oy: 0 }, ext: { w: 96, h: 30 } }, g);
    expect(box?.b).toEqual({ c: 2, fx: 0.5, r: 2, fy: 0.5 });
  });
  it("vị trí tuyệt đối (absoluteAnchor) tính từ A1", () => {
    const box = anchorBox({ pos: { x: 128, y: 40 }, ext: { w: 64, h: 20 } }, g);
    expect(box).toEqual({ a: { c: 2, fx: 0, r: 2, fy: 0 }, b: { c: 3, fx: 0, r: 3, fy: 0 } });
  });
  it("thiếu dữ liệu neo thì bỏ qua", () => {
    expect(anchorBox({}, g)).toBeNull();
    expect(anchorBox({ from: { c: 0, r: 0, ox: 0, oy: 0 } }, g)).toBeNull();
  });
});

describe("dibToBmp", () => {
  it("thêm phần đầu tệp BMP với vị trí điểm ảnh đúng (ảnh 24-bit không bảng màu)", () => {
    const dib = new Uint8Array(40 + 12);
    const v = new DataView(dib.buffer);
    v.setUint32(0, 40, true);
    v.setInt32(4, 2, true);
    v.setInt32(8, 2, true);
    v.setUint16(12, 1, true);
    v.setUint16(14, 24, true);
    const bmp = dibToBmp(dib)!;
    const bv = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(bv.getUint32(2, true)).toBe(bmp.length);
    expect(bv.getUint32(10, true)).toBe(54);
  });
  it("ảnh 8-bit có bảng màu 256 màu", () => {
    const dib = new Uint8Array(40 + 1024 + 4);
    const v = new DataView(dib.buffer);
    v.setUint32(0, 40, true);
    v.setUint16(14, 8, true);
    expect(new DataView(dibToBmp(dib)!.buffer).getUint32(10, true)).toBe(14 + 40 + 1024);
  });
  it("dữ liệu không phải DIB thì trả null", () => {
    expect(dibToBmp(new Uint8Array(10))).toBeNull();
    expect(dibToBmp(new Uint8Array(40))).toBeNull(); // header size = 0
  });
});
