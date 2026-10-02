"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkBook } from "xlsx";
import { anchorBox, colName, excelGeometry, type AnchorBox } from "@/lib/office-preview/excel-geometry";
import { readXlsPictures, readXlsxPictures, type ExcelPicture, type ExcelPictureEntry, type ExcelPictures } from "@/lib/office-preview/excel-images";

// Vẽ tối đa ngần này dòng/cột — tệp lớn hơn thì báo "tải về để xem đủ", không để
// trình duyệt đơ vì dựng bảng quá nhiều ô (QA 02/10/2026: 2000×60 ô mất ~4 giây mỗi lần
// vẽ/thu phóng; tệp đính kèm thật dài nhất đo được ~600 dòng).
const MAX_ROWS = 1000;
const MAX_COLS = 60;

/** Đọc nội dung tệp — trả lỗi rõ ràng thay vì để SheetJS "đọc được" byte rác thành bảng lạ. */
function readWorkbook(XLSX: XlsxModule, bytes: Uint8Array, ext: string): WorkBook {
  if (bytes.length === 0) throw new Error("empty");
  const opts = { cellDates: true, cellStyles: true } as const;
  if (ext === "csv") {
    // CSV UTF-8 không có BOM: SheetJS tự đoán sai thành Latin-1 → lỗi dấu tiếng Việt. Thử giải mã
    // UTF-8 nghiêm ngặt trước; không phải UTF-8 (vd CSV xuất từ Excel theo bảng mã Windows)
    // thì để SheetJS tự xử lý như cũ.
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return XLSX.read(text.replace(/^﻿/, ""), { ...opts, type: "string" });
    } catch {
      return XLSX.read(bytes, { ...opts, type: "array" });
    }
  }
  // .xlsx/.xlsm là gói zip — không bắt đầu bằng "PK" thì là tệp hỏng/đổi đuôi.
  if ((ext === "xlsx" || ext === "xlsm") && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("not-zip");
  return XLSX.read(bytes, { ...opts, type: "array" });
}
const ROW_HEADER_WIDTH = 40;

type XlsxModule = typeof import("xlsx");
interface Loaded {
  wb: WorkBook;
  XLSX: XlsxModule;
  pictures: ExcelPictures;
}
interface Placed {
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Xem nhanh Excel (.xls/.xlsx/.xlsm/.csv) trong popup tệp đính kèm — dạng bảng như Excel:
 * tên cột A, B, C…, số dòng, ô gộp, độ rộng cột/chiều cao dòng theo tệp gốc, nhiều sheet
 * (tab dưới đáy), thu/phóng, và ẢNH chèn trong tệp đặt đúng ô (lib/office-preview/*).
 * Chỉ xem: không giữ màu nền/viền/màu chữ, không vẽ biểu đồ — cần đầy đủ thì "Tải về".
 * Sếp chốt 02/10/2026.
 */
export default function ExcelPreview({ data, ext }: { data: ArrayBuffer; ext: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetName, setSheetName] = useState("");
  const [zoom, setZoom] = useState(100);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const bytes = new Uint8Array(data);
        const wb = readWorkbook(XLSX, bytes, ext);
        let pictures: ExcelPictures = { bySheet: {}, byIndex: [] };
        try {
          if (ext === "xls") pictures = readXlsPictures(bytes, XLSX);
          else if (ext !== "csv") pictures = await readXlsxPictures(bytes, (await import("jszip")).default);
        } catch {
          // Không đọc được ảnh thì vẫn xem được dữ liệu ô — ảnh chỉ là phần thêm.
        }
        if (cancelled) return;
        setLoaded({ wb, XLSX, pictures });
        setSheetName(wb.SheetNames[0] ?? "");
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, ext]);

  // Mỗi ảnh 1 object URL, thu hồi khi đổi tệp/đóng popup.
  const urls = useMemo(() => {
    const map = new Map<ExcelPicture, string>();
    if (!loaded) return map;
    for (const list of loaded.pictures.byIndex) {
      for (const p of list) {
        if (!("unsupported" in p)) map.set(p, URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: p.mime })));
      }
    }
    return map;
  }, [loaded]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const picturesOf = (name: string): ExcelPictureEntry[] => {
    if (!loaded) return [];
    return loaded.pictures.bySheet[name] ?? loaded.pictures.byIndex[loaded.wb.SheetNames.indexOf(name)] ?? [];
  };

  const model = useMemo(() => {
    if (!loaded || !sheetName) return null;
    const { wb, XLSX } = loaded;
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    const g = excelGeometry(ws);
    const entries = loaded.pictures.bySheet[sheetName] ?? loaded.pictures.byIndex[wb.SheetNames.indexOf(sheetName)] ?? [];
    const boxes: { pic: ExcelPicture; box: AnchorBox }[] = [];
    let unsupported = 0;
    for (const p of entries) {
      if ("unsupported" in p) unsupported++;
      else {
        const box = anchorBox(p, g);
        if (box) boxes.push({ pic: p, box });
      }
    }
    if (!ws["!ref"] && !boxes.length) return { html: "", boxes, unsupported, truncated: false, empty: true };

    // Luôn vẽ từ A1 như Excel, và vẽ đủ tới chỗ có ảnh (ảnh hay nằm ngoài vùng có chữ).
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
    let needC = range.e.c;
    let needR = range.e.r;
    for (const { box } of boxes) {
      needC = Math.max(needC, box.b.c);
      needR = Math.max(needR, box.b.r);
    }
    const lastR = Math.min(needR, MAX_ROWS - 1);
    const lastC = Math.min(needC, MAX_COLS - 1);

    const span = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const m of ws["!merges"] ?? []) {
      span.set(`${m.s.r}:${m.s.c}`, { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 });
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
    }
    const z = zoom / 100;
    const widths = Array.from({ length: lastC + 1 }, (_, c) => g.colW(c) * z);
    const hasText = (r: number, c: number) => {
      const x = ws[XLSX.utils.encode_cell({ r, c })];
      return !!x && x.v !== undefined && x.v !== null && x.v !== "";
    };
    // Cố định độ rộng cột như Excel (chữ dài không làm phình cột) — chữ dài tràn sang ô
    // trống bên phải như Excel; ô bên phải có chữ thì bị cắt.
    let html = `<table class="xl" style="font-size:${13 * z}px;width:${ROW_HEADER_WIDTH + widths.reduce((a, b) => a + b, 0)}px"><colgroup><col style="width:${ROW_HEADER_WIDTH}px">${widths.map((w) => `<col style="width:${w}px">`).join("")}</colgroup><thead><tr><th class="rn"></th>`;
    for (let c = 0; c <= lastC; c++) html += `<th>${widths[c] >= 14 ? colName(c) : ""}</th>`;
    html += "</tr></thead><tbody>";
    for (let r = 0; r <= lastR; r++) {
      html += `<tr style="height:${Math.max(g.rowH(r) * z, 1)}px"><td class="rn">${r + 1}</td>`;
      for (let c = 0; c <= lastC; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const sp = span.get(`${r}:${c}`);
        const text = cell
          ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString("vi-VN") : String(cell.v ?? "")))
          : "";
        const isNum = cell?.t === "n";
        const spill = !!text && !isNum && !sp && c < lastC && !hasText(r, c + 1) && !covered.has(`${r}:${c + 1}`);
        const classes = [isNum ? "num" : "", spill ? "spill" : "", sp && sp.cs > 1 ? "mc" : ""].filter(Boolean).join(" ");
        const safe = escapeHtml(String(text));
        html += `<td${classes ? ` class="${classes}"` : ""}${sp ? ` rowspan="${sp.rs}" colspan="${sp.cs}"` : ""}${safe ? ` title="${safe}"` : ""}>${safe}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    return { html, boxes, unsupported, truncated: lastR < needR || lastC < needC, empty: false };
  }, [loaded, sheetName, zoom]);

  // Đặt ảnh lên đúng ô: đo vị trí cột/dòng THẬT trên bảng vừa vẽ. Popup mở có hiệu ứng
  // phóng to (scale 0.96 → 1, globals.css `animate-modal-pop`): số đo getBoundingClientRect
  // lúc đó bị co lại theo tỉ lệ — chia lại cho tỉ lệ (kích thước bố cục / kích thước hiển thị)
  // để ra vị trí thật, đo lúc nào cũng đúng (QA 02/10/2026: tệp về nhanh → ảnh lệch sang H4).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const table = canvas?.querySelector("table");
    if (!canvas || !table || !model) {
      setPlaced([]);
      return;
    }
    const base = canvas.getBoundingClientRect();
    const sx = base.width > 0 ? canvas.offsetWidth / base.width : 1;
    const sy = base.height > 0 ? canvas.offsetHeight / base.height : 1;
    const heads = table.tHead?.rows[0]?.cells;
    const body = table.tBodies[0]?.rows;
    const colBox = (c: number) => {
      const el = heads?.[c + 1];
      if (!el) return null;
      const q = el.getBoundingClientRect();
      return { x: (q.left - base.left) * sx, w: q.width * sx };
    };
    const rowBox = (r: number) => {
      const el = body?.[r];
      if (!el) return null;
      const q = el.getBoundingClientRect();
      return { y: (q.top - base.top) * sy, h: q.height * sy };
    };
    const next: Placed[] = [];
    for (const { pic, box } of model.boxes) {
      const url = urls.get(pic);
      const c1 = colBox(box.a.c);
      const c2 = colBox(box.b.c);
      const r1 = rowBox(box.a.r);
      const r2 = rowBox(box.b.r);
      if (!url || !c1 || !c2 || !r1 || !r2) continue;
      const left = c1.x + box.a.fx * c1.w;
      const top = r1.y + box.a.fy * r1.h;
      const width = c2.x + box.b.fx * c2.w - left;
      const height = r2.y + box.b.fy * r2.h - top;
      if (width >= 2 && height >= 2) next.push({ url, left, top, width, height });
    }
    setPlaced(next);
    scrollRef.current?.scrollTo(0, 0);
  }, [model, urls]);

  if (failed) {
    return (
      <p className="m-auto px-6 text-center text-[14px] text-gray-400">
        Không đọc được nội dung tệp (có thể tệp bị hỏng hoặc có mật khẩu). Bấm &quot;Tải về&quot; để xem trên máy.
      </p>
    );
  }
  if (!loaded) return <p className="m-auto text-[14px] text-gray-400">Đang mở tệp…</p>;

  const pictureCount = model ? model.boxes.length : 0;
  return (
    <div className="office-xl flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-[var(--color-border)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-gray-50 px-3 py-1.5 text-[12px] text-gray-500 dark:bg-white/5 dark:text-gray-300">
        <span>Thu/phóng:</span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(50, z - 25))}
          className="h-6 w-6 rounded border border-[var(--color-border)] bg-white hover:bg-gray-100 dark:bg-white/10 dark:hover:bg-white/20"
          aria-label="Thu nhỏ"
        >
          −
        </button>
        <b className="w-10 text-center">{zoom}%</b>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(200, z + 25))}
          className="h-6 w-6 rounded border border-[var(--color-border)] bg-white hover:bg-gray-100 dark:bg-white/10 dark:hover:bg-white/20"
          aria-label="Phóng to"
        >
          +
        </button>
        {pictureCount > 0 && <span className="font-semibold text-blue-700 dark:text-blue-300">🖼 {pictureCount} ảnh</span>}
        {model && model.unsupported > 0 && (
          <span>· {model.unsupported} ảnh dạng chưa hiện được (EMF/WMF/SVG…) – tải về để xem</span>
        )}
        {model?.truncated && (
          <span className="ml-auto">Chỉ hiện {MAX_ROWS} dòng / {MAX_COLS} cột đầu – tải về để xem đủ</span>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {model?.empty ? (
          <p className="py-10 text-center text-[14px] text-gray-400">Sheet trống.</p>
        ) : (
          <div ref={canvasRef} className="relative inline-block">
            <div dangerouslySetInnerHTML={{ __html: model?.html ?? "" }} />
            {placed.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh tách từ tệp Excel (object URL), next/image không dùng được
              <img
                key={i}
                src={p.url}
                alt="Ảnh trong tệp Excel"
                className="pointer-events-none absolute z-[2] max-w-none"
                style={{ left: p.left, top: p.top, width: p.width, height: p.height }}
              />
            ))}
          </div>
        )}
      </div>
      {loaded.wb.SheetNames.length > 0 && (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-t border-[var(--color-border)] bg-gray-50 px-2 dark:bg-white/5">
          {loaded.wb.SheetNames.map((name) => {
            const count = picturesOf(name).filter((p) => !("unsupported" in p)).length;
            const active = name === sheetName;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setSheetName(name)}
                className={`whitespace-nowrap border-b-[3px] px-3.5 py-1.5 text-[13px] ${
                  active ? "border-green-600 bg-white font-semibold text-green-800 dark:bg-white/10 dark:text-green-300" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {name}
                {count > 0 ? ` 🖼${count}` : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
