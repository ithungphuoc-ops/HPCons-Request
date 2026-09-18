import { createSignedReadUrl } from "@/lib/r2";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";
import type { ProposalField, RequestAttachment, RequestInstance } from "@/lib/types";

/**
 * Đồng bộ đề xuất đã duyệt xong sang QLK CTR (app quản lý kho công trình) — xem
 * openspec/changes/add-qlkctr-sync-webhook. Không đổi field/UI nào của nhóm đề xuất,
 * chỉ đọc lại 2 field có sẵn ("Tên đề xuất" mang chuỗi "Mã hợp đồng - Tên công trình",
 * "Chi tiết" là bảng vật tư) rồi gửi sang API riêng của QLK CTR.
 *
 * Không có quyền đọc Firestore thật của app này để xác nhận đúng `field.code`/thứ tự cột
 * — nên tra theo NHIỀU mã quen thuộc + fallback theo tên hiển thị, và tra vị trí cột theo
 * TÊN cột (field.tableColumns) chứ không theo số thứ tự cố định.
 */

const DETAIL_FIELD_CODES = new Set(["chi_tiet", "vat_tu", "vat_tu_de_nghi", "danh_sach_vat_tu"]);
const LUA_CHON_DE_NGHI_FIELD_CODES = new Set(["lua_chon_de_nghi"]);
const NGAY_CAN_CAP_FIELD_CODES = new Set(["ngay_de_nghi_cap", "ngay_can_cap", "ngay_can_giao"]);

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

const GIA_TRI_DE_NGHI_CONG_TRINH = chuanHoaSoSanh("Đề nghị công trình");

export type QlkCtrVatTu = {
  tenVatTu: string;
  quyCach?: string;
  dvt: string;
  soLuong: number;
  mucDichSuDung?: string;
};

export type QlkCtrTaiLieuDinhKem = { ten: string; url: string };

export type QlkCtrPayload = {
  requestId: string;
  requestCode: string;
  tieuDe?: string;
  nguoiGui: string;
  ngayDuyet: string;
  ngayCanGiao?: string;
  congTrinhChuoi: string;
  vatTu: QlkCtrVatTu[];
  taiLieuDinhKem?: QlkCtrTaiLieuDinhKem[];
};

/**
 * Lấy tất cả file đính kèm ở MỌI field kiểu "file" của đề xuất (không giới hạn 1 field cụ thể —
 * BCH có thể đính kèm PDF/Excel ở bất kỳ field file nào nhóm cấu hình), quy đổi mỗi file thành 1
 * link tải có chữ ký (hết hạn sau 5 phút — đủ dùng vì QLK CTR tải ngay trong lúc xử lý request
 * duyệt này, xem lib/r2.ts::createSignedReadUrl). QLK CTR chỉ lưu lại để xem sau, không đọc dữ
 * liệu vật tư từ các file này (vật tư luôn lấy từ bảng "Chi tiết" như cũ).
 */
async function layTaiLieuDinhKem(request: RequestInstance): Promise<QlkCtrTaiLieuDinhKem[]> {
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
  const taiLieu: QlkCtrTaiLieuDinhKem[] = [];
  ketQua.forEach((r, i) => {
    if (r.status === "fulfilled") taiLieu.push({ ten: files[i].name, url: r.value });
  });
  return taiLieu;
}

/**
 * Trả về `null` nếu không đủ dữ liệu để gửi (thiếu field "Tên đề xuất"/"Chi tiết", thiếu cột
 * bắt buộc "Tên hàng"/"Số lượng", hoặc bảng chi tiết rỗng), HOẶC nếu field "Lựa chọn đề nghị" có
 * mặt nhưng giá trị KHÔNG phải "Đề nghị công trình" (VD "Đề nghị phòng ban" — không có công trình,
 * QLK CTR không giữ loại này) — KHÔNG throw, để nơi gọi tự quyết định bỏ qua êm (đề xuất không
 * liên quan công trình vẫn duyệt bình thường). Field không tồn tại (nhóm cũ chưa có) thì vẫn cho
 * qua như trước, để không phá luồng đã chạy ổn định.
 */
export async function trichXuatPayload(request: RequestInstance): Promise<QlkCtrPayload | null> {
  const titleField = timField(request.fieldsSnapshot, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const detailField = timField(request.fieldsSnapshot, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!titleField || !detailField) return null;

  const luaChonField = timField(request.fieldsSnapshot, LUA_CHON_DE_NGHI_FIELD_CODES, ["Lựa chọn đề nghị"]);
  if (luaChonField) {
    const giaTri = chuanHoaSoSanh(String(request.values[luaChonField.id] ?? ""));
    if (giaTri && giaTri !== GIA_TRI_DE_NGHI_CONG_TRINH) return null;
  }

  const congTrinhChuoi = String(request.values[titleField.id] ?? "").trim();
  if (!congTrinhChuoi) return null;

  const cot = detailField.tableColumns ?? [];
  const idxTen = timCotBang(cot, "tên hàng", "tên vật tư");
  const idxSL = timCotBang(cot, "số lượng", "sl");
  if (idxTen < 0 || idxSL < 0) return null;
  const idxQuyCach = timCotBang(cot, "quy cách", "chủng loại");
  const idxDvt = timCotBang(cot, "đvt", "đơn vị");
  const idxMucDich = timCotBang(cot, "mục đích");

  const rows = deserializeTableRows(request.values[detailField.id]);
  const vatTu: QlkCtrVatTu[] = rows
    .map((r) => ({
      tenVatTu: (r[idxTen] ?? "").trim(),
      quyCach: idxQuyCach >= 0 ? r[idxQuyCach]?.trim() || undefined : undefined,
      dvt: idxDvt >= 0 ? (r[idxDvt] ?? "").trim() : "",
      soLuong: Number(r[idxSL]) || 0,
      mucDichSuDung: idxMucDich >= 0 ? r[idxMucDich]?.trim() || undefined : undefined,
    }))
    .filter((v) => v.tenVatTu && v.soLuong > 0);
  if (vatTu.length === 0) return null;

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);

  const ngayCanCapField = timField(request.fieldsSnapshot, NGAY_CAN_CAP_FIELD_CODES, ["Ngày đề nghị cấp"]);
  const ngayCanGiao = ngayCanCapField
    ? String(request.values[ngayCanCapField.id] ?? "").trim() || undefined
    : undefined;

  return {
    requestId: request.id,
    requestCode: request.code ?? request.id,
    tieuDe: congTrinhChuoi,
    nguoiGui: request.submittedBy.name,
    ngayDuyet: new Date().toISOString().slice(0, 10),
    ...(ngayCanGiao ? { ngayCanGiao } : {}),
    congTrinhChuoi,
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
  };
}

export type KetQuaGuiQlkCtr =
  | { ok: true; trangThai: string; congTrinh?: string }
  | { ok: false; error: string };

/**
 * ★★★ QLK CTR CÓ THẬT SỰ TẠO ĐỀ NGHỊ KHÔNG — thêm 18/09/2026.
 *
 * 🔴 ĐÂY LÀ CHỖ ĐÃ GÂY BA SỰ CỐ TRONG NĂM NGÀY, VÀ LÝ DO RẤT PHẢN TRỰC GIÁC.
 *
 * QLK CTR trả về `ok: true` (HTTP 200) cho **hai** kết cục khác hẳn nhau:
 *   · `trangThai: "da_tao_de_nghi"`              → đã tạo thật, có `congTrinh`
 *   · `trangThai: "bo_qua_khong_khop_cong_trinh"` → **KHÔNG tạo gì**, không giữ lại gì
 *
 * Bên này trước đây chỉ đọc `ok` rồi ghi *"Đã đồng bộ sang QLK CTR"* cho cả hai. Người đọc
 * nhật ký thấy dòng đó thì tin là xong. Thực tế đo được ngày 18/09/2026: bốn đề xuất công
 * trình (`000000096`, `000000098`, `000000100`, `000000104`) **không có** ở kho, mà nhật ký
 * của chúng đều ghi "Đã đồng bộ".
 *
 * ⚠️ ĐỪNG SO BẰNG `congTrinh` RỖNG THAY VÌ SO `trangThai`. Nghe tương đương nhưng không:
 * ngày mai QLK CTR thêm một kết cục mới (ví dụ "đã tạo nhưng chờ xác nhận vật tư") mà quên
 * gửi tên công trình, thì phép so kiểu đó lặng lẽ xếp nó thành "bỏ qua" và app thử lại vô
 * ích mãi. So đúng tên trạng thái thì kết cục lạ sẽ rơi vào nhánh `else` và lộ ra.
 */
export function daTaoDeNghiThat(ketQua: KetQuaGuiQlkCtr): boolean {
  return ketQua.ok && ketQua.trangThai === "da_tao_de_nghi";
}

/**
 * Trạng thái ghi lên đề xuất sau một lần gửi — xem `qlkCtrSyncStatus` ở `lib/types.ts`.
 *
 * 🔴 BA TRẠNG THÁI, KHÔNG PHẢI HAI. Gộp `"bo_qua"` vào `"failed"` thì mất khả năng phân biệt
 * "kho sập / mạng hỏng" với "kho chạy tốt nhưng chưa nhận diện được công trình" — hai chuyện
 * cần hai cách xử lý khác nhau (một cái chờ kho sống lại, một cái cần admin tạo công trình).
 */
export function trangThaiSauKhiGui(ketQua: KetQuaGuiQlkCtr): "synced" | "failed" | "bo_qua" {
  if (!ketQua.ok) return "failed";
  return ketQua.trangThai === "da_tao_de_nghi" ? "synced" : "bo_qua";
}

/**
 * Câu ghi vào nhật ký đề xuất — phải nói ĐÚNG việc đã xảy ra.
 *
 * 🔴 CÂU CHO `"bo_qua"` LÀ PHẦN QUAN TRỌNG NHẤT CỦA CẢ LƯỢT VÁ NÀY. Người đọc nhật ký phải
 * hiểu ngay là **kho chưa có đề nghị này** và phải làm gì. Câu cũ *"Đã đồng bộ sang QLK CTR —
 * Công trình: chờ xác nhận"* vừa sai sự thật, vừa nghe như đang chờ ai đó xử lý tiếp.
 */
export function cauNhatKyQlkCtr(ketQua: KetQuaGuiQlkCtr): { action: string; note: string } {
  if (!ketQua.ok) {
    return { action: "Đồng bộ QLK CTR thất bại", note: ketQua.error };
  }
  if (ketQua.trangThai === "da_tao_de_nghi") {
    return {
      action: "Đã đồng bộ sang QLK CTR",
      note: `Công trình: ${ketQua.congTrinh ?? "(kho không gửi tên)"}`,
    };
  }
  return {
    action: "QLK CTR CHƯA nhận — bỏ qua vì không khớp công trình",
    note:
      "App Kho không tìm ra công trình nào khớp với Tên đề xuất, nên CHƯA tạo đề nghị. " +
      "Kiểm tra công trình đã có trong danh mục App Kho chưa, và mã hợp đồng trong Tên đề xuất " +
      "có khớp mã bên đó không. App sẽ tự thử lại mỗi lần có người mở đề xuất này.",
  };
}

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) đều trả về qua `{ ok: false, error }`. */
export async function guiSangQlkCtr(payload: QlkCtrPayload): Promise<KetQuaGuiQlkCtr> {
  const url = process.env.QLKCTR_API_URL;
  if (!url) return { ok: false, error: "Chưa cấu hình QLKCTR_API_URL." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/de-nghi-duyet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QLKCTR_API_KEY ? { "x-api-key": process.env.QLKCTR_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; trangThai?: string; congTrinh?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, trangThai: data.trangThai ?? "", congTrinh: data.congTrinh };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}

/**
 * ★★★ TỰ THỬ LẠI ĐỒNG BỘ SANG QLK CTR — thêm 18/09/2026, vá bệnh gốc của ba sự cố.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 VÌ SAO CẦN — BỐN ĐỀ XUẤT MẤT TÍCH, ĐO ĐƯỢC NGÀY 18/09/2026
 * ════════════════════════════════════════════════════════════════════════════════════════
 * Đường sang App Thu mua có `retryThuMuaSyncNeuLoi` từ đầu. Đường sang QLK CTR thì không —
 * gửi một lần, hỏng là hỏng vĩnh viễn. Kết quả đối chiếu hai đầu:
 *
 *   Kho CÓ   : 000000099 · 000000102 · 000000103
 *   Kho THIẾU: 000000096 · 000000098 · 000000100 · 000000104
 *
 * Bốn cái thiếu đều là đề nghị CÔNG TRÌNH, đều đã duyệt xong, và nhật ký của chúng đều ghi
 * *"Đã đồng bộ sang QLK CTR"*. Không ai biết cho tới khi Thu mua lập đơn và bị kho từ chối —
 * ca 000000085 (13/09), 000000096 (17/09), rồi 000000100 (18/09).
 *
 * 🔴 HAI NGUYÊN NHÂN BỎ QUA, VÀ CẢ HAI ĐỀU TỰ KHỎI THEO THỜI GIAN — đó là lý do thử lại có
 * tác dụng thật, không phải thử lại cho có:
 *   ① App Kho chưa có công trình đó trong danh mục. Admin kho tạo thêm là lần sau khớp.
 *      (ca 000000104 — công trình AID chưa tạo)
 *   ② App Kho so mã công trình còn sai. Vá xong là lần sau khớp.
 *      (ca 000000096/98/100 — lỗi dấu `/` vs `-`, vá lúc 10:12 ngày 17/09)
 *
 * Khác hẳn lỗi "sai dữ liệu đề xuất": chỗ đó gửi lại y nguyên thì đời nào cũng trượt, và
 * thử lại chỉ đốt hạn mức. Ở đây phía BÊN KIA đổi, nên lần sau có cơ hội thật.
 *
 * 🔴 GỌI KIỂU "BẮN RỒI QUÊN" (`void retryQlkCtrSyncNeuLoi(...)`, KHÔNG `await`) — đúng nếp
 * `retryThuMuaSyncNeuLoi`. Đây là việc phụ; không được làm chậm phản hồi của màn hình, và
 * không được để nó làm hỏng response chính. Tự bắt hết lỗi, không throw ra ngoài.
 *
 * ⚠️ KHÔNG có bậc chờ tăng dần như phía Thu mua, và đó là cố ý: nhịp thử ở đây do **người
 * dùng mở đề xuất** quyết định, chứ không phải bộ hẹn giờ. Một đề xuất không ai mở thì không
 * tốn lượt gọi nào; đề xuất đang được theo dõi thì thử lại thường xuyên — đúng chỗ cần.
 */
export async function retryQlkCtrSyncNeuLoi(request: RequestInstance): Promise<void> {
  /* Chỉ đề xuất ĐÃ DUYỆT mới có việc ở kho. `synced` thì xong rồi; `undefined` nghĩa là chưa
     từng thử — để nguyên, vì có thể đề xuất này không thuộc loại công trình. */
  if (request.status !== "approved") return;
  if (request.qlkCtrSyncStatus !== "failed" && request.qlkCtrSyncStatus !== "bo_qua") return;

  try {
    const payload = await trichXuatPayload(request);
    /* `null` = đề xuất không phải loại công trình, hoặc thiếu vật tư hợp lệ. Không có gì để
       gửi, và cũng không nên giữ cờ lỗi mãi — nhưng đừng đổi cờ ở đây: `trichXuatPayload`
       trả `null` cũng vì lý do tạm (đọc R2 hỏng), xoá cờ là mất dấu vết cần thử lại. */
    if (!payload) return;

    const ketQua = await guiSangQlkCtr(payload);
    const { action, note } = cauNhatKyQlkCtr(ketQua);
    const { adminDb } = await import("@/lib/firebase/admin");
    const syncEntry = {
      at: new Date().toISOString(),
      actor: "Hệ thống",
      action: `${action} (tự thử lại)`,
      note,
    };
    await adminDb.collection("requests").doc(request.id).update({
      qlkCtrSyncStatus: trangThaiSauKhiGui(ketQua),
      history: [...request.history, syncEntry],
    });
  } catch (err) {
    console.error(`Tự thử lại đồng bộ QLK CTR cho đề xuất ${request.id} lỗi:`, err);
  }
}
