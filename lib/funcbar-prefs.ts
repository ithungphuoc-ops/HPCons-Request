/**
 * Thanh chức năng (FuncBar) kéo rộng/hẹp + ẩn/hiện trên màn hình ≥ lg (1024px) — Sếp duyệt demo
 * 19/10/2026. Màn nhỏ giữ nguyên cách mở trượt bằng nút ☰ ở AppBar.
 *
 * Lưu theo từng trình duyệt (localStorage), không lưu lên máy chủ.
 */
export const FUNCBAR_DEFAULT_WIDTH = 200;
export const FUNCBAR_MIN_WIDTH = 160;
export const FUNCBAR_MAX_WIDTH = 400;
export const FUNCBAR_WIDTH_KEY = "request-funcbar-width";
export const FUNCBAR_COLLAPSED_KEY = "request-funcbar-collapsed";

/** Độ rộng AppBar (thanh đen, `w-20`) và phần tối thiểu chừa cho vùng nội dung bên phải. */
const APPBAR_WIDTH = 80;
const MAIN_MIN_WIDTH = 320;

export function clampFuncbarWidth(width: number, viewportWidth: number): number {
  const room = viewportWidth - APPBAR_WIDTH - MAIN_MIN_WIDTH;
  const max = Math.max(FUNCBAR_MIN_WIDTH, Math.min(FUNCBAR_MAX_WIDTH, room));
  return Math.min(Math.max(Math.round(width), FUNCBAR_MIN_WIDTH), max);
}

/** Giá trị lưu hỏng/ngoài khoảng → `null` (dùng mặc định). */
export function parseStoredFuncbarWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < FUNCBAR_MIN_WIDTH || n > FUNCBAR_MAX_WIDTH) return null;
  return n;
}

/**
 * Chạy NGAY khi trình duyệt đọc tới (trước khi vẽ thanh bên), chèn 1 thẻ <style> theo lựa chọn đã
 * lưu — nếu chờ React chạy xong mới đọc localStorage thì thanh bên sẽ hiện độ rộng mặc định rồi mới
 * "giật" sang độ rộng đã lưu / tự trượt đóng. Quy tắc ẩn dùng `:not([data-collapsed])`: chỉ có tác
 * dụng tới lúc FuncBar gắn thuộc tính `data-collapsed` thật, sau đó CSS chính trong globals.css lo.
 */
export const FUNCBAR_PREPAINT_SCRIPT = `(function(){try{var w=parseInt(localStorage.getItem(${JSON.stringify(
  FUNCBAR_WIDTH_KEY,
)}),10);var c=localStorage.getItem(${JSON.stringify(FUNCBAR_COLLAPSED_KEY)})==="1";var css="";if(w>=${FUNCBAR_MIN_WIDTH}&&w<=${FUNCBAR_MAX_WIDTH})css+=":root{--funcbar-w:"+w+"px}";if(c)css+="@media (min-width:1024px){.funcbar-wrap:not([data-collapsed]){width:0}.funcbar-wrap:not([data-collapsed])>nav{display:none}}";if(css){var s=document.createElement("style");s.id="funcbar-prepaint";s.textContent=css;document.head.appendChild(s);}}catch(e){}})();`;
