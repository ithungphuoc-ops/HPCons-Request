import { createSignedReadUrl } from "@/lib/r2";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";
import type { ProposalField, RequestAttachment, RequestInstance } from "@/lib/types";

/**
 * Đồng bộ đề xuất đã duyệt xong sang App Thu mua (module mua hàng của HP Cons) — SONG SONG
 * với nhánh gọi QLK CTR (`lib/qlkctr-sync.ts`), KHÔNG thay thế nó.
 *
 * 🔴 KHÁC QLK CTR ở điểm quan trọng nhất: Thu mua nhận **MỌI** đề xuất duyệt xong, có công
 * trình hay không (đề xuất riêng của một phòng ban — vd văn phòng phẩm — vẫn phải gửi qua,
 * Thu mua tự xử lý). QLK CTR chỉ nhận khi có công trình vì nó không có gì để làm với đề
 * xuất không liên quan công trình. Vì vậy hàm `trichXuatPayloadThuMua` dưới đây KHÔNG gate
 * theo `congTrinhChuoi` rỗng/không rỗng như bên QLK CTR — chỉ gate theo có đủ vật tư/phòng
 * ban hay không.
 *
 * Đọc lại 2 field có sẵn ("Tên đề xuất" cho công trình — có thể rỗng, "Chi tiết" cho vật tư)
 * cộng thêm field kiểu `department_select` ("Chọn bộ phận") cho phòng ban — không đổi field/UI
 * nào của nhóm đề xuất.
 */

const DETAIL_FIELD_CODES = new Set(["chi_tiet", "vat_tu", "vat_tu_de_nghi", "danh_sach_vat_tu"]);

function chuanHoaSoSanh(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function timField(fields: ProposalField[], codes: Set<string>, tenGanDung: string[]): ProposalField | null {
  const theoCode = fields.find((f) => f.code && codes.has(f.code));
  if (theoCode) return theoCode;
  const theoTen = fields.find((f) => tenGanDung.some((t) => chuanHoaSoSanh(f.name) === chuanHoaSoSanh(t)));
  return theoTen ?? null;
}

function timCotBang(cot: string[], ...tenGanDung: string[]): number {
  return cot.findIndex((c) => tenGanDung.some((t) => chuanHoaSoSanh(c).includes(chuanHoaSoSanh(t))));
}

export type ThuMuaVatTu = {
  tenVatTu: string;
  quyCach?: string;
  dvt: string;
  soLuong: number;
  mucDichSuDung?: string;
};

export type ThuMuaTaiLieuDinhKem = { ten: string; url: string };

/**
 * Người theo dõi đề xuất, gửi kèm sang Thu mua.
 *
 * 🔴 BA TRƯỜNG NÀY LÀ HỢP ĐỒNG VỚI BÊN THU MUA — đừng đổi tên. Bên đó đọc đúng `id` / `name` /
 * `username` (xem `HPCons-ThuMua/2-quy-trinh/tich-hop-app-request.ts::layNguoiTheoDoiTuAppRequest`,
 * hàm bỏ qua mọi phần tử không có `id`). Trùng khớp với `TaggedUser` nên gửi thẳng được, không
 * phải nắn lại hình dạng.
 *
 * `id` chính là uid trong `users` của App Tổng — thứ DUY NHẤT có tác dụng thật bên Thu mua
 * (quyền xem theo hồ sơ, tab "Tôi theo dõi", thông báo chuyển bước).
 */
export type ThuMuaNguoiTheoDoi = { id: string; name: string; username: string };

export type ThuMuaPayload = {
  requestCode: string;
  requestId: string;
  tieuDe?: string;
  nguoiGuiTen: string;
  nguoiGuiUid?: string;
  nguoiGuiEmail: string;
  ngayGui: string;
  ngayDuyet: string;
  ngayCanGiao?: string;
  /** Rỗng = đề xuất của một phòng ban, không gắn công trình nào — Thu mua vẫn nhận. */
  congTrinhChuoi?: string;
  phongBan: string;
  vatTu: ThuMuaVatTu[];
  taiLieuDinhKem?: ThuMuaTaiLieuDinhKem[];
  /**
   * LUÔN GỬI, kể cả khi rỗng. Thu mua tự tra chức danh từng người từ danh bạ App Tổng.
   *
   * 🔴 MẢNG RỖNG KHÁC HẲN VẮNG MẶT (đổi 23/09/2026). Rỗng = "đã xét, hồ sơ này không có ai
   * theo dõi"; vắng mặt = "app này không nói gì". Trước đây bỏ hẳn trường khi rỗng, nên Thu
   * mua không phân biệt được và phải đọc ngược sang Firestore của app này để tự kiểm — chính
   * là lượt đọc đang hỏng vì thiếu khoá. Gửi mảng rỗng là họ biết ngay khỏi phải hỏi.
   */
  nguoiTheoDoi?: ThuMuaNguoiTheoDoi[];
  /**
   * Người đề nghị tự khai trên biểu mẫu: `"cong_trinh"` hay `"phong_ban"`.
   *
   * 🔴 VÌ SAO THÊM (23/09/2026): trước đây Thu mua phải **tự đọc sang Firestore của app này**
   * để lấy trường đó, và việc ấy cần một khoá Admin của project `hpcons-request` đặt bên Thu
   * mua. Khoá đó chưa từng được cấp — log Thu mua báo *"Thiếu
   * APP_REQUEST_FIREBASE_SERVICE_ACCOUNT"* mỗi lần nhận đề nghị, và họ phải rơi về phép suy
   * "mã hợp đồng rỗng thì là hồ sơ phòng ban".
   *
   * Gửi thẳng ở đây rẻ hơn hẳn: app này đã cầm sẵn `fieldsSnapshot` + `values`, không tốn
   * lượt đọc nào, và **không phải cấp cho Thu mua quyền đọc toàn bộ dữ liệu đề xuất**. Phía
   * Thu mua đã chừa sẵn đường này (nhánh ① trong `app/api/app-request/de-nghi-moi/route.ts`).
   *
   * ⚠️ Vắng mặt khi người dùng bỏ trống ô, hoặc biểu mẫu không có ô đó. Thu mua tự rơi về
   * phép suy dự phòng — ĐỪNG đoán bừa rồi gửi sang.
   */
  loaiDeNghi?: "cong_trinh" | "phong_ban";
};

/** Chuẩn hoá nhãn để so sánh: bỏ dấu cách thừa, không phân biệt hoa thường. */
function chuanNhan(x: string): string {
  return x.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Đọc ô "Lựa chọn đề nghị" trên biểu mẫu → `"cong_trinh"` | `"phong_ban"`.
 *
 * 🔴 TÌM Ô THEO `options`, TUYỆT ĐỐI KHÔNG THEO MÃ TRƯỜNG. Mã là UUID và **đổi theo từng đời
 * biểu mẫu** — phía Thu mua đã đo ba mã khác nhau cho cùng một ô. Viết cứng một mã là hôm nào
 * phát hành biểu mẫu mới thì đọc hụt trong im lặng, không một dòng báo lỗi.
 *
 * 🔴 NHƯNG ĐỐI CHIẾU GIÁ TRỊ THÌ PHẢI SO BẰNG VỚI ĐÚNG NHÃN, không "chứa cụm từ"
 * (CodeRabbit chỉ ra ở PR #39). Bản đầu dùng `/công\s*trình/.test(...)`, nên một lựa chọn thứ
 * ba như *"Không phải công trình"* cũng ra `"cong_trinh"` — mà Thu mua coi trường này là lời
 * khai của người dùng và **tin tuyệt đối, kể cả khi mâu thuẫn với mã hợp đồng**. Gửi sai còn
 * tệ hơn không gửi.
 *
 * 🔴 XÉT HẾT MỌI Ô KHỚP, KHÔNG DỪNG Ở Ô ĐẦU (cũng CodeRabbit, PR #39). Biểu mẫu không ép ô
 * loại này là duy nhất; dừng ở ô đầu thì một ô bỏ trống đứng trước sẽ che mất lựa chọn thật ở
 * ô sau, và hai ô chọn khác nhau lại được phân xử bằng thứ tự — thứ không ai kiểm soát.
 * Bỏ qua ô để trống, và **mâu thuẫn thì trả `undefined`**.
 *
 * ⚠️ `undefined` = "app này không biết chắc". Thu mua rơi về phép suy dự phòng của họ
 * (mã hợp đồng rỗng thì là hồ sơ phòng ban) — đúng thứ họ vẫn làm trước khi có trường này.
 */
export function layLoaiDeNghiGuiSangThuMua(
  fields: readonly { id: string; options?: string[] }[],
  values: Record<string, unknown>,
): "cong_trinh" | "phong_ban" | undefined {
  const daThay = new Set<"cong_trinh" | "phong_ban">();

  for (const f of fields) {
    const ops = Array.isArray(f.options) ? f.options.map(String) : [];

    /* Nhận diện ô: khớp đúng nhãn trước, rơi về "bắt đầu bằng" để chịu được nhãn có thêm phần
       giải thích. Neo `^` loại được nhãn phủ định kiểu "Không phải đề nghị công trình". */
    const timNhan = (re: RegExp, chuan: string) =>
      ops.find((x) => chuanNhan(x) === chuan) ?? ops.find((x) => re.test(chuanNhan(x)));
    const nhanCT = timNhan(/^đề nghị\s*công trình/, "đề nghị công trình");
    const nhanPB = timNhan(/^đề nghị\s*phòng ban/, "đề nghị phòng ban");
    if (!nhanCT || !nhanPB) continue; // không phải ô cần tìm

    const v = values[f.id];
    if (typeof v !== "string" || !v.trim()) continue; // người dùng bỏ trống → bỏ qua ô này

    const chon = chuanNhan(v);
    if (chon === chuanNhan(nhanCT)) daThay.add("cong_trinh");
    else if (chon === chuanNhan(nhanPB)) daThay.add("phong_ban");
    else return undefined; // chọn một lựa chọn khác trong cùng ô → không suy diễn
  }

  /* 0 ô có giá trị → không biết. 2 loại khác nhau → mâu thuẫn, cũng không biết. */
  return daThay.size === 1 ? [...daThay][0] : undefined;
}

/**
 * Lọc danh sách người theo dõi trước khi gửi sang Thu mua.
 *
 * 🔴 VÌ SAO CẦN LỌC chứ không gửi thẳng `request.followers`:
 *
 * ① BỎ NHÓM. `TaggedUser` có `kind: "group"` — khi đó `id` là mã NHÓM, không phải uid người.
 *    Gửi sang là bên Thu mua dựng một "người theo dõi" mang mã nhóm: không ai nhận được thông
 *    báo, không ai được mở hồ sơ, mà giao diện vẫn bày ra một dòng như thể có người. Hiện
 *    `followers` chỉ chứa người (`kind` để trống), nhưng trường này tồn tại nên chặn sẵn.
 *
 * ② BỎ PHẦN TỬ THIẾU `id`. Bên Thu mua cũng bỏ, nhưng lọc từ đây thì gói tin sạch và
 *    người đọc log không phải đoán vì sao số người hai bên lệch nhau.
 *
 * ③ BỎ TRÙNG THEO `id`, GIỮ NGƯỜI ĐẦU. Cùng một người xuất hiện hai lần là bên Thu mua có hai
 *    dòng y hệt, mà thao tác gỡ người theo dõi lại lọc theo uid nên gỡ một phát mất cả hai —
 *    người dùng tưởng app hỏng.
 *
 * ④ CHỈ LẤY BA TRƯỜNG. `TaggedUser` còn `avatarInitial`, `title`, `kind` — Thu mua không dùng,
 *    gửi thừa chỉ làm gói tin nặng thêm và tạo ràng buộc giả giữa hai app.
 *
 * ⚠️ KHÔNG NÉM LỖI. Dữ liệu lạ chỉ được làm mất người theo dõi, KHÔNG được làm hỏng cả lượt
 * đồng bộ đề nghị — cùng nguyên tắc với cửa tiếp nhận bên Thu mua.
 */
export function layNguoiTheoDoiGuiSangThuMua(nguon: unknown): ThuMuaNguoiTheoDoi[] {
  if (!Array.isArray(nguon)) return [];

  const ra: ThuMuaNguoiTheoDoi[] = [];
  const daCo = new Set<string>();

  for (const phanTu of nguon) {
    if (phanTu === null || typeof phanTu !== "object" || Array.isArray(phanTu)) continue;
    const o = phanTu as { id?: unknown; name?: unknown; username?: unknown; kind?: unknown };

    if (o.kind === "group") continue;

    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id || daCo.has(id)) continue;
    daCo.add(id);

    ra.push({
      id,
      name: typeof o.name === "string" ? o.name.trim() : "",
      username: typeof o.username === "string" ? o.username.trim() : "",
    });
  }

  return ra;
}

/** Cùng logic tải tệp đính kèm với `qlkctr-sync.ts` — xem chú thích ở đó. */
async function layTaiLieuDinhKem(request: RequestInstance): Promise<ThuMuaTaiLieuDinhKem[]> {
  const files: RequestAttachment[] = [];
  for (const field of request.fieldsSnapshot) {
    if (field.dataType !== "file") continue;
    const value = request.values[field.id];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const path = (item as Partial<RequestAttachment> | undefined)?.path;
      const name = (item as Partial<RequestAttachment> | undefined)?.name;
      if (typeof path === "string" && typeof name === "string") files.push({ path, name, size: 0 });
    }
  }
  if (files.length === 0) return [];

  const ketQua = await Promise.allSettled(files.map((f) => createSignedReadUrl(f.path)));
  const taiLieu: ThuMuaTaiLieuDinhKem[] = [];
  ketQua.forEach((r, i) => {
    if (r.status === "fulfilled") taiLieu.push({ ten: files[i].name, url: r.value });
  });
  return taiLieu;
}

/**
 * Trả `null` nếu không đủ dữ liệu để gửi (thiếu mã đề xuất, thiếu field "Chi tiết", thiếu
 * cột bắt buộc "Tên hàng"/"Số lượng", bảng chi tiết rỗng, hoặc KHÔNG tìm được field "Chọn bộ
 * phận") — KHÔNG throw, để nơi gọi tự quyết định bỏ qua êm.
 *
 * 🔴 KHÔNG gate theo công trình — đề xuất phòng ban (không có field "Tên đề xuất" hoặc field
 * đó rỗng) VẪN gửi, chỉ để `congTrinhChuoi` rỗng.
 */
export async function trichXuatPayloadThuMua(request: RequestInstance): Promise<ThuMuaPayload | null> {
  if (!request.code) return null;

  const detailField = timField(request.fieldsSnapshot, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!detailField) return null;

  const cot = detailField.tableColumns ?? [];
  const idxTen = timCotBang(cot, "tên hàng", "tên vật tư");
  const idxSL = timCotBang(cot, "số lượng", "sl");
  if (idxTen < 0 || idxSL < 0) return null;
  const idxQuyCach = timCotBang(cot, "quy cách", "chủng loại");
  const idxDvt = timCotBang(cot, "đvt", "đơn vị");
  const idxMucDich = timCotBang(cot, "mục đích");

  const rows = deserializeTableRows(request.values[detailField.id]);
  const vatTu: ThuMuaVatTu[] = rows
    .map((r) => ({
      tenVatTu: (r[idxTen] ?? "").trim(),
      quyCach: idxQuyCach >= 0 ? r[idxQuyCach]?.trim() || undefined : undefined,
      dvt: idxDvt >= 0 ? (r[idxDvt] ?? "").trim() : "",
      soLuong: Number(r[idxSL]) || 0,
      mucDichSuDung: idxMucDich >= 0 ? r[idxMucDich]?.trim() || undefined : undefined,
    }))
    .filter((v) => v.tenVatTu && v.soLuong > 0);
  if (vatTu.length === 0) return null;

  const departmentField = request.fieldsSnapshot.find((f) => f.dataType === "department_select");
  const phongBan = departmentField ? String(request.values[departmentField.id] ?? "").trim() : "";
  if (!phongBan) return null;

  const titleField = timField(request.fieldsSnapshot, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const congTrinhChuoi = titleField ? String(request.values[titleField.id] ?? "").trim() || undefined : undefined;

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);
  const nguoiTheoDoi = layNguoiTheoDoiGuiSangThuMua(request.followers);
  const loaiDeNghi = layLoaiDeNghiGuiSangThuMua(request.fieldsSnapshot, request.values);

  return {
    requestCode: request.code,
    requestId: request.id,
    tieuDe: congTrinhChuoi,
    nguoiGuiTen: request.submittedBy.name,
    nguoiGuiUid: request.submittedBy.uid,
    nguoiGuiEmail: request.submittedBy.email,
    ngayGui: request.submittedAt.slice(0, 10),
    ngayDuyet: new Date().toISOString().slice(0, 10),
    congTrinhChuoi,
    phongBan,
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
    /* Gửi cả khi rỗng — xem chú thích ở khai báo trường. */
    nguoiTheoDoi,
    ...(loaiDeNghi ? { loaiDeNghi } : {}),
  };
}

export type KetQuaGuiThuMua =
  | { ok: true; trangThai: string; maDeNghi?: string }
  | { ok: false; error: string };

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) đều trả về qua `{ ok: false, error }`. */
export async function guiSangThuMua(payload: ThuMuaPayload): Promise<KetQuaGuiThuMua> {
  const url = process.env.THUMUA_API_URL;
  if (!url) return { ok: false, error: "Chưa cấu hình THUMUA_API_URL." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/de-nghi-moi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.THUMUA_API_KEY ? { "x-api-key": process.env.THUMUA_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; trangThai?: string; maDeNghi?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, trangThai: data.trangThai ?? "", maDeNghi: data.maDeNghi };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}

/**
 * TỰ THỬ LẠI khi lần đồng bộ trước đó thất bại (`thuMuaSyncStatus === "failed"`) — Sếp yêu
 * cầu 20/08/2026 sau sự cố Thu mua tạm thời trả lỗi vì lệch bản deploy: *"nếu app lỗi như
 * vậy nữa, khi mình khắc phục xong thì app phải tự đọc lại để nhận lại đề nghị cũ"*.
 *
 * Gọi hàm này ở những nơi người dùng hay ghé qua đề xuất đã duyệt — màn danh sách "Tôi gửi
 * đi"/"Đang theo dõi" và màn chi tiết — nên không cần đợi lịch (cron) mới thử lại: hễ có
 * người mở lại đúng đề xuất đó SAU KHI Thu mua đã sửa xong, lần mở đó tự vá luôn, không ai
 * phải tìm và gửi lại tay.
 *
 * 🔴 GỌI KIỂU "BẮN RỒI QUÊN" (`void retryThuMuaSyncNeuLoi(...)`, không `await`) ở API route —
 * không được làm chậm phản hồi của màn hình chỉ vì một lần đồng bộ phụ đang thử lại.
 * Tự bắt hết lỗi, không throw ra ngoài.
 */
export async function retryThuMuaSyncNeuLoi(request: RequestInstance): Promise<void> {
  if (request.status !== "approved" || request.thuMuaSyncStatus !== "failed") return;

  try {
    const payload = await trichXuatPayloadThuMua(request);
    if (!payload) return;

    const ketQua = await guiSangThuMua(payload);
    const { adminDb } = await import("@/lib/firebase/admin");
    const syncEntry = {
      at: new Date().toISOString(),
      actor: "Hệ thống",
      action: ketQua.ok ? "Đã đồng bộ sang App Thu mua (tự thử lại)" : "Đồng bộ App Thu mua thất bại (tự thử lại)",
      note: ketQua.ok ? `Mã đề nghị: ${ketQua.maDeNghi ?? "—"}` : ketQua.error,
    };
    await adminDb.collection("requests").doc(request.id).update({
      thuMuaSyncStatus: ketQua.ok ? "synced" : "failed",
      history: [...request.history, syncEntry],
    });
  } catch (err) {
    console.error(`Tự thử lại đồng bộ App Thu mua cho đề xuất ${request.id} lỗi:`, err);
  }
}
