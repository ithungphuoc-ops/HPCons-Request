import type { ProposalField, RequestInstance } from "@/lib/types";

/**
 * ★ GỬI ĐỀ XUẤT SANG APP KẾ TOÁN — "Kế hoạch thanh toán" (Sếp chốt 19/10/2026, làm thầu phụ trước).
 *
 *   POST {KETOAN_API_URL}/api/app-tong/de-xuat-thau-phu      header  x-api-key: {KETOAN_API_KEY}
 *
 * Hình dạng bản chụp là HỢP ĐỒNG với App Kế toán (HPCons-KeToanCons, `7-phai-tra/de-xuat-thau-phu.ts`,
 * `phienBan: 1`) — đổi tên trường thì phải đổi cả hai bên. App Kế toán trả `ok:true` khi đã ghi (gửi lại
 * cùng `maDeXuat` không tạo dòng thứ hai) và `ok:false` + mã HTTP khi từ chối:
 *   400 dữ liệu thiếu/sai · 401 sai khoá · 422 nhóm không được nhận · 5xx lỗi máy chủ.
 * Hàng chờ (`lib/dong-bo/luat.ts::phanLoaiLoi`) tự coi 4xx là lỗi vĩnh viễn, 5xx là tạm thời.
 *
 * Mẫu đăng ký đề xuất "Thanh toán NTP" (10 trường) → bản chụp. Tìm field theo MÃ trước, theo TÊN sau
 * (tên bỏ dấu, bỏ số thứ tự đầu "06."), vì mã của vài trường chưa được xác nhận:
 *   01 Tên đề xuất (ten_de_xuat)  02 Số HĐ CĐT (so_hop_dong_cdt)  03 Tên công trình (ten_cong_trinh)
 *   04 Tên NTP (ten_ncc)  05 Số HĐ NTP (so_hop_dong_ncc)  06 Đợt thanh toán  07 Số tiền (so_tien)
 *   08 Bộ phận  09 Ngày đề nghị thanh toán  10 Ghi chú  (+ "Trả phiếu" ở form cũ).
 */

export type KeToanPayload = {
  phienBan: 1;
  maDeXuat: string;
  tenDeXuat: string;
  soHdCdt: string;
  congTrinh: string;
  nhaThauPhu: string;
  soHdNtp: string;
  dot: string;
  /** Chuỗi thô người dùng nhập ("20,520,000 VNĐ" hoặc "20520000") — App Kế toán tự đọc. */
  soTien: string;
  boPhan: string;
  /** dd/mm/yyyy hoặc yyyy-mm-dd — App Kế toán tự chuẩn hoá. */
  ngayDeNghi: string;
  ghiChu: string;
  nguoiTao: string;
  nguoiDuyet: { ten: string; chucVu: string; thoiDiem: string };
  linkDeXuat: string;
  nhomDeXuat: string;
  /** id nhóm đề xuất — ổn định khi đổi tên nhóm (3. → 4.0 → 5.0). */
  nhomId: string;
  fileBBNT: string[];
  traPhieu: string;
  trangThaiDeXuat: "da_duyet_ky_thuat" | "bi_tra_lai";
  lyDoTraLai: string;
};

function chuanHoa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/^\s*\d+[.)]?\s*/, "") // bỏ số thứ tự đầu tên ("06. Đợt thanh toán")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tìm field: ưu tiên mã, rồi tên khớp CHÍNH XÁC sau chuẩn hoá, cuối cùng tên CHỨA cụm cần tìm. */
export function timFieldKeToan(
  fields: ProposalField[],
  codes: string[],
  tens: string[],
): ProposalField | undefined {
  const theoMa = fields.find((f) => f.code && codes.includes(f.code));
  if (theoMa) return theoMa;
  const cacTen = tens.map(chuanHoa);
  return (
    fields.find((f) => cacTen.includes(chuanHoa(f.name ?? ""))) ??
    fields.find((f) => cacTen.some((t) => chuanHoa(f.name ?? "").includes(t)))
  );
}

function giaTri(request: Pick<RequestInstance, "values">, f: ProposalField | undefined): string {
  if (!f) return "";
  const v = request.values[f.id];
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  return "";
}

/** Tên các file đính kèm ở mọi ô kiểu "file" (BBNT, hoá đơn…). Không ký link: App Kế toán chỉ cần tên + link đề xuất. */
export function tenFileDinhKem(request: Pick<RequestInstance, "fieldsSnapshot" | "values">): string[] {
  const ten: string[] = [];
  for (const f of request.fieldsSnapshot) {
    if (f.dataType !== "file") continue;
    const v = request.values[f.id];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      const name = (item as { name?: unknown } | undefined)?.name;
      if (typeof name === "string" && name.trim()) ten.push(name.trim());
    }
  }
  return ten;
}

export function dungBanChupKeToan(
  request: RequestInstance,
  opts: {
    trangThaiDeXuat: KeToanPayload["trangThaiDeXuat"];
    nguoiDuyet: string;
    lyDoTraLai?: string;
    baseUrl: string;
    bayGioIso: string;
  },
): KeToanPayload | null {
  if (!request.code) return null;
  const F = request.fieldsSnapshot;
  const t = (codes: string[], tens: string[]) => giaTri(request, timFieldKeToan(F, codes, tens));

  const boPhanField = F.find((f) => f.dataType === "department_select") ?? timFieldKeToan(F, [], ["Bộ phận"]);
  const nhomId = request.groupId ?? "";
  const ngayDeNghi = t([], ["Ngày đề nghị thanh toán", "Ngày đề nghị"]) || request.submittedAt.slice(0, 10);

  return {
    phienBan: 1,
    maDeXuat: request.code,
    tenDeXuat: t(["ten_de_xuat"], ["Tên đề xuất"]),
    soHdCdt: t(["so_hop_dong_cdt"], ["Số hợp đồng CĐT"]),
    congTrinh: t(["ten_cong_trinh"], ["Tên công trình"]),
    nhaThauPhu: t(["ten_ncc", "ten_ntp"], ["Tên Nhà thầu phụ", "Tên NTP", "Tên NCC"]),
    soHdNtp: t(["so_hop_dong_ncc", "so_hop_dong_ntp"], ["Số hợp đồng NTP", "Số hợp đồng NCC"]),
    dot: t(["dot_thanh_toan"], ["Đợt thanh toán"]),
    soTien: t(["so_tien"], ["Số tiền"]),
    boPhan: giaTri(request, boPhanField),
    ngayDeNghi,
    ghiChu: t(["ghi_chu"], ["Ghi chú"]),
    nguoiTao: request.submittedBy.name,
    nguoiDuyet: { ten: opts.nguoiDuyet, chucVu: "", thoiDiem: opts.bayGioIso },
    linkDeXuat: `${opts.baseUrl.replace(/\/$/, "")}/request/${encodeURIComponent(request.code)}`,
    nhomDeXuat: typeof request.groupNameSnapshot === "string" ? request.groupNameSnapshot.trim() : "",
    nhomId,
    fileBBNT: tenFileDinhKem(request),
    traPhieu: t([], ["Trả phiếu"]),
    trangThaiDeXuat: opts.trangThaiDeXuat,
    lyDoTraLai: opts.lyDoTraLai ?? "",
  };
}

export type KetQuaGuiKeToan =
  | { ok: true; trangThai: string; keHoach: string | null }
  | { ok: false; error: string; httpStatus?: number; loaiLoi?: string };

const THOI_GIAN_CHO_MS = 25_000;

/** Không throw: mọi lỗi trả qua `{ ok:false }` để hàng chờ phân loại và hẹn gửi lại. */
export async function guiSangKeToan(payload: KeToanPayload): Promise<KetQuaGuiKeToan> {
  const url = process.env.KETOAN_API_URL;
  const khoa = process.env.KETOAN_API_KEY;
  if (!url) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình KETOAN_API_URL." };
  if (!khoa) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình KETOAN_API_KEY." };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-tong/de-xuat-thau-phu`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": khoa },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(THOI_GIAN_CHO_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      trangThai?: string;
      keHoach?: string | null;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}`, httpStatus: res.status };
    }
    return { ok: true, trangThai: data.trangThai ?? "", keHoach: data.keHoach ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
