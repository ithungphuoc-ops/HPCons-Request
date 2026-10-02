import { readFileSync } from "fs";
import path from "path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { anchorBox, excelGeometry } from "./excel-geometry";
import { readXlsPictures, readXlsxPictures, type ExcelPicture, type ExcelPictureEntry } from "./excel-images";

// 2 tệp mẫu tạo bằng Excel thật (02/10/2026): sheet "Tole mái" có logo (PNG, góc A1) và ảnh
// hiện trường (JPEG, đặt tại J5); sheet "Diềm theo trục" có hình mặt cắt (PNG, đặt tại F2).
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, "__fixtures__", name)));
const pictures = (list: ExcelPictureEntry[] | undefined) => (list ?? []).filter((p): p is ExcelPicture => !("unsupported" in p));
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function expectSamplePictures(result: Awaited<ReturnType<typeof readXlsxPictures>>, file: Uint8Array) {
  expect(Object.keys(result.bySheet)).toEqual(["Tole mái", "Diềm theo trục"]);
  expect(result.byIndex).toHaveLength(2);

  const wb = XLSX.read(file, { type: "array", cellStyles: true });
  const [logo, photo] = pictures(result.bySheet["Tole mái"]);
  expect(pictures(result.bySheet["Tole mái"])).toHaveLength(2);
  expect(logo.mime).toBe("image/png");
  expect(isPng(logo.bytes)).toBe(true);
  expect(photo.mime).toBe("image/jpeg");
  expect(isJpeg(photo.bytes)).toBe(true);

  const g1 = excelGeometry(wb.Sheets["Tole mái"]);
  const logoBox = anchorBox(logo, g1)!;
  expect(logoBox.a).toMatchObject({ c: 0, r: 0 }); // A1
  expect(logoBox.b.c).toBe(1); // tràn sang cột B
  const photoBox = anchorBox(photo, g1)!;
  expect(photoBox.a).toMatchObject({ c: 9, r: 4 }); // J5
  expect(photoBox.a.fx).toBeCloseTo(0, 2);

  const [sketch] = pictures(result.bySheet["Diềm theo trục"]);
  expect(pictures(result.bySheet["Diềm theo trục"])).toHaveLength(1);
  expect(sketch.mime).toBe("image/png");
  expect(anchorBox(sketch, excelGeometry(wb.Sheets["Diềm theo trục"]))!.a).toMatchObject({ c: 5, r: 1 }); // F2
}

describe("readXlsPictures (.xls Excel 97-2003)", () => {
  it("lấy đủ ảnh + neo ô của từng sheet", () => {
    const file = fixture("co-anh.xls");
    expectSamplePictures(readXlsPictures(file, XLSX), file);
  });

  it("tệp không phải Excel đời cũ thì báo lỗi để nơi gọi bỏ qua phần ảnh", () => {
    expect(() => readXlsPictures(new Uint8Array([1, 2, 3, 4]), XLSX)).toThrow();
  });
});

describe("readXlsxPictures (.xlsx)", () => {
  it("lấy đủ ảnh + neo ô của từng sheet", async () => {
    const file = fixture("co-anh.xlsx");
    expectSamplePictures(await readXlsxPictures(file, JSZip), file);
  });

  it("tệp .xlsx không có ảnh thì danh sách rỗng", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", 1]]), "S1");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const result = await readXlsxPictures(new Uint8Array(out), JSZip);
    expect(result.bySheet).toEqual({ S1: [] });
  });
});
