/**
 * Tô XANH LÁ phần chữ trùng từ khoá — CHUẨN toàn hệ sinh thái (Sếp chốt
 * 17/08/2026, chép từ hpcons-portal components/ui/HighlightMatch.tsx):
 * so khớp KHÔNG DẤU (gõ "phong ban" vẫn tô đúng "Phòng ban"), tô MỌI lần
 * xuất hiện, an toàn chuỗi NFD/emoji nhờ map từng code unit về vị trí gốc.
 */
export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Chuẩn hoá chuỗi để LỌC (bỏ dấu + thường) — dùng cùng cặp với HighlightMatch
 * để bộ lọc và phần tô màu khớp nhau tuyệt đối. */
export function normalizeSearch(s: string): string {
  return stripDiacritics(s).toLowerCase();
}

function normChar(ch: string): string {
  return stripDiacritics(ch).toLowerCase();
}

export default function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = stripDiacritics(query).toLowerCase().trim();
  if (!q) return <>{text}</>;

  const chars = [...text.normalize("NFC")];
  const map: number[] = [];
  let norm = "";
  chars.forEach((ch, i) => {
    const n = normChar(ch);
    norm += n;
    for (let k = 0; k < n.length; k++) map.push(i);
  });

  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = norm.indexOf(q, from);
    if (at === -1) break;
    ranges.push([map[at], map[at + q.length - 1] + 1]);
    from = at + q.length;
  }
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(chars.slice(cursor, start).join(""));
    parts.push(
      <mark key={i} className="rounded bg-green-100 px-0.5 font-semibold text-green-800">
        {chars.slice(start, end).join("")}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(""));
  return <>{parts}</>;
}
