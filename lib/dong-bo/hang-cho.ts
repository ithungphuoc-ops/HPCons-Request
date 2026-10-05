import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { createSignedReadUrl } from "@/lib/r2";
import { loadRequest } from "@/lib/server/requests";
import { cauNhatKyQlkCtr, daTaoDeNghiThat, guiSangQlkCtr, trichXuatPayload } from "@/lib/qlkctr-sync";
import { guiSangThuMua, trichXuatPayloadThuMua } from "@/lib/thumua-sync";
import { guiCapNhatSuKien } from "@/lib/dong-bo/gui";
import {
  biChanBoiViecTruoc,
  denHanGui,
  HAN_DUNG_MS,
  NHAN_DICH,
  NHAN_LOAI,
  phanLoaiLoi,
  quyetDinhSauLoi,
  THOI_GIAN_KHOA_MS,
  type DichDongBo,
  type LoaiLoi,
  type LoaiSuKien,
  type TrangThaiViec,
} from "@/lib/dong-bo/luat";
import type { RequestHistoryEntry } from "@/lib/types";

/**
 * ★★ HÀNG CHỜ ĐỒNG BỘ App Request → Kho / Thu mua — đợt 1 "liên kết 4 app" (Sếp chốt 03/10/2026).
 *
 * Mỗi sự kiện (duyệt xong · xoá · khôi phục · điều chỉnh sau duyệt · thêm tài liệu) sinh 1 VIỆC cho
 * MỖI app đích, lưu ở collection `hang_cho_dong_bo`. Việc được gửi NGAY (sau khi trả response, qua
 * `after()`), lỗi thì hẹn lại theo luật ở `luat.ts`.
 *
 * 🔴 GỬI LẠI KHÔNG DÙNG HẸN GIỜ DÀY (gói Vercel miễn phí chỉ cho cron 1 lần/ngày):
 *   · `quetViecToiHan()` — gọi kèm các API người dùng hay mở (danh sách / chi tiết đề xuất), tối đa
 *     1 lần/phút/máy chủ. Giờ hành chính luôn có người dùng nên gần như đúng hạn.
 *   · `quetHangDem()` — cron 2:00 sáng, vét mọi việc còn chờ và dừng việc quá 1 ngày.
 *
 * 📌 Chỉ việc ĐANG CHỜ mới có field `henLuc` — xong / dừng / huỷ thì XOÁ field đó, để truy vấn
 * `henLuc <= bây giờ` (chỉ mục 1 trường, Firestore tự có) chỉ trả đúng việc còn chờ, không cần tạo
 * chỉ mục ghép.
 *
 * 📌 Không sinh dữ liệu thừa: mỗi việc có mã riêng, bên nhận gặp lại mã đã xử lý thì bỏ qua.
 */

const COL = "hang_cho_dong_bo";

export type ViecDongBo = {
  id: string;
  requestId: string;
  requestCode: string | null;
  dich: DichDongBo;
  loai: LoaiSuKien;
  nguoi: string | null;
  lucSuKien: string;
  noiDung: string | null;
  taiLieu: { name: string; path: string }[];
  trangThai: TrangThaiViec;
  soLanThu: number;
  /** Mốc XẾP THỨ TỰ — không bao giờ đổi sau khi tạo (đổi là việc sau có thể chen lên trước). */
  taoLuc: number;
  /** Mốc tính hạn 1 ngày — "Gửi lại ngay" đặt lại mốc này, KHÔNG đặt lại `taoLuc` (QA 03/10). */
  hanDungTu?: number | null;
  /** Việc "duyet" bị huỷ vì đề xuất bị xoá — khôi phục đề xuất thì gọi lại việc này (QA 03/10). */
  huyDoXoa?: boolean | null;
  /** Dừng CHỈ VÌ chờ việc trước quá 1 ngày — việc trước gửi xong thì tự chạy lại. */
  dungDoChan?: boolean | null;
  henLuc?: number | null;
  khoaDen?: number | null;
  loi?: string | null;
  loaiLoi?: LoaiLoi | null;
  ketQua?: string | null;
  capNhatLuc: number;
  xongLuc?: number | null;
};

function docViec(snap: FirebaseFirestore.DocumentSnapshot): ViecDongBo {
  return { id: snap.id, ...(snap.data() as Omit<ViecDongBo, "id">) };
}

// ------------------------------------------------------------------------------------------------
// TẠO VIỆC
// ------------------------------------------------------------------------------------------------

export async function taoViecDongBo(input: {
  requestId: string;
  requestCode: string | null;
  loai: LoaiSuKien;
  nguoi?: string | null;
  noiDung?: string | null;
  taiLieu?: { name: string; path: string }[];
  dichs?: DichDongBo[];
}): Promise<string[]> {
  const bayGio = Date.now();
  const dichs = input.dichs ?? ["kho", "thumua"];
  const batch = adminDb.batch();
  const ids: string[] = [];

  // Xoá đề xuất → huỷ việc "gửi đề nghị" của chính đề xuất đó nếu chưa tới nơi (đang chờ / đã dừng),
  // để app đích KHÔNG BAO GIỜ nhận một đề nghị đã bị xoá.
  //   · Việc ĐANG GỬI DỞ (còn khoá) thì KHÔNG huỷ — huỷ lúc đó thì lần ghi "đã gửi" sau sẽ đè mất
  //     (QA 03/10). Cứ để nó tới nơi; việc "xoá" vừa tạo xếp sau nó nên sẽ ẩn đề nghị ngay sau đó.
  //   · Đánh dấu `huyDoXoa` để khôi phục đề xuất thì gọi lại đúng việc này.
  // Khôi phục đề xuất → gọi lại việc "gửi đề nghị" đã bị huỷ vì xoá (QA 03/10: trước đó khôi phục chỉ
  // gửi "khoi_phuc", app đích chưa từng có đề nghị nên trả "không có", đề nghị không bao giờ sang).
  //   · Giữ NGUYÊN `taoLuc` để nó vẫn đi trước việc "khoi_phuc" vừa tạo.
  // Việc sau duyet được gọi lại khi khôi phục — nối vào `ids` SAU việc duyet được gọi lại.
  const sauDuyet: string[] = [];
  if (input.loai === "xoa" || input.loai === "khoi_phuc") {
    const cu = await adminDb.collection(COL).where("requestId", "==", input.requestId).get();

    // Khôi phục (QA 03/10, lần 2): điều chỉnh / thêm tệp ghi SAU việc "duyet" nhưng tới nơi lúc app đích
    // CHƯA có đề nghị (vì duyet bị huỷ do xoá) → bên nhận trả "khong_co_de_nghi" và việc bị coi là xong
    // → nội dung mất. Gọi lại luôn những việc đó (giữ `taoLuc` để vẫn đi sau việc duyet được gọi lại).
    // Bên nhận chưa ghi dấu chống trùng cho các việc này nên gửi lại sẽ được áp dụng bình thường.
    if (input.loai === "khoi_phuc") {
      const duyetGoiLai = new Map<DichDongBo, number>();
      for (const d of cu.docs) {
        const v = d.data() as ViecDongBo;
        if (v.loai === "duyet" && v.trangThai === "huy" && v.huyDoXoa && dichs.includes(v.dich)) {
          duyetGoiLai.set(v.dich, v.taoLuc);
        }
      }
      const viecSau = cu.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ViecDongBo, "id">) }))
        .filter(
          (v) =>
            (v.loai === "dieu_chinh" || v.loai === "them_file") &&
            v.trangThai === "da_gui" &&
            v.ketQua === "khong_co_de_nghi" &&
            duyetGoiLai.has(v.dich) &&
            v.taoLuc > (duyetGoiLai.get(v.dich) ?? Infinity),
        )
        .sort((a, b) => a.taoLuc - b.taoLuc);
      for (const v of viecSau) {
        batch.update(adminDb.collection(COL).doc(v.id), {
          trangThai: "cho",
          soLanThu: 0,
          hanDungTu: bayGio,
          henLuc: bayGio,
          khoaDen: 0,
          ketQua: null,
          loi: null,
          xongLuc: null,
          capNhatLuc: bayGio,
        });
        sauDuyet.push(v.id);
      }
    }

    for (const d of cu.docs) {
      const v = d.data() as ViecDongBo;
      if (v.loai !== "duyet" || !dichs.includes(v.dich)) continue;
      if (input.loai === "xoa" && (v.trangThai === "cho" || v.trangThai === "dung") && !((v.khoaDen ?? 0) > bayGio)) {
        batch.update(d.ref, {
          trangThai: "huy",
          huyDoXoa: true,
          henLuc: FieldValue.delete(),
          khoaDen: 0,
          loi: "Huỷ vì đề xuất đã bị xoá trước khi gửi được",
          capNhatLuc: bayGio,
        });
      }
      if (input.loai === "khoi_phuc" && v.trangThai === "huy" && v.huyDoXoa) {
        batch.update(d.ref, {
          trangThai: "cho",
          huyDoXoa: false,
          soLanThu: 0,
          hanDungTu: bayGio,
          henLuc: bayGio,
          khoaDen: 0,
          loi: null,
          capNhatLuc: bayGio,
        });
        ids.push(d.id);
      }
    }
    ids.push(...sauDuyet);
  }

  for (const dich of dichs) {
    // "duyet" dùng mã cố định → bấm duyệt 2 lần / gọi lại cũng chỉ có 1 việc.
    const ref =
      input.loai === "duyet"
        ? adminDb.collection(COL).doc(`duyet-${dich}-${input.requestId}`)
        : adminDb.collection(COL).doc();
    if (input.loai === "duyet" && (await ref.get()).exists) continue;
    batch.set(ref, {
      requestId: input.requestId,
      requestCode: input.requestCode,
      dich,
      loai: input.loai,
      nguoi: input.nguoi ?? null,
      lucSuKien: new Date(bayGio).toISOString(),
      noiDung: input.noiDung ?? null,
      taiLieu: input.taiLieu ?? [],
      trangThai: "cho",
      soLanThu: 0,
      taoLuc: bayGio,
      hanDungTu: bayGio,
      huyDoXoa: false,
      henLuc: bayGio,
      khoaDen: 0,
      loi: null,
      loaiLoi: null,
      ketQua: null,
      capNhatLuc: bayGio,
      xongLuc: null,
    });
    ids.push(ref.id);
  }
  await batch.commit();
  // Việc gọi lại (khôi phục) nằm đầu mảng `ids` theo thứ tự đẩy vào → gửi trước việc mới.
  return ids;
}

// ------------------------------------------------------------------------------------------------
// GỬI 1 VIỆC
// ------------------------------------------------------------------------------------------------

type KetQuaThucHien =
  | { loai: "thanh_cong"; ketQua: string; nhatKy: { action: string; note?: string } }
  | { loai: "huy"; lyDo: string; doXoa?: boolean }
  | { loai: "loi"; error: string; httpStatus?: number; loaiLoiBenNhan?: string };

async function thucHien(viec: ViecDongBo): Promise<KetQuaThucHien> {
  if (viec.loai === "duyet") {
    const request = await loadRequest(viec.requestId);
    if (!request) return { loai: "huy", lyDo: "Không tìm thấy đề xuất." };
    if (request.deletedAt) return { loai: "huy", lyDo: "Đề xuất đã bị xoá trước khi gửi được.", doXoa: true };

    if (viec.dich === "kho") {
      const payload = await trichXuatPayload(request);
      if (!payload) return { loai: "huy", lyDo: "Không thuộc diện gửi Kho (không phải đề nghị công trình, hoặc thiếu bảng vật tư)." };
      const kq = await guiSangQlkCtr(payload);
      if (daTaoDeNghiThat(kq)) {
        const { action, note } = cauNhatKyQlkCtr(kq);
        return { loai: "thanh_cong", ketQua: "da_tao_de_nghi", nhatKy: { action, note } };
      }
      if (kq.ok) return { loai: "loi", error: cauNhatKyQlkCtr(kq).note, loaiLoiBenNhan: "tam_thoi" };
      // "Không khớp công trình" TỰ KHỎI khi Admin Kho đồng bộ thêm công trình từ Công nợ (ca 000000104,
      // xem chú thích `qlkCtrSyncStatus` ở lib/types.ts) → coi là TẠM THỜI để còn gửi lại trong 1 ngày,
      // không dừng ngay như lỗi dữ liệu khác.
      const tuKhoi = kq.httpStatus === 400 && /không khớp được công trình/i.test(kq.error);
      return {
        loai: "loi",
        error: kq.error,
        httpStatus: kq.httpStatus,
        loaiLoiBenNhan: tuKhoi ? "tam_thoi" : kq.loaiLoi,
      };
    }

    const payload = await trichXuatPayloadThuMua(request);
    if (!payload) return { loai: "huy", lyDo: "Không đủ dữ liệu gửi Thu mua (thiếu bộ phận hoặc bảng vật tư)." };
    if (!payload.loaiDeNghi) {
      return {
        loai: "loi",
        loaiLoiBenNhan: "vinh_vien",
        error: "Ô \"Lựa chọn đề nghị\" mâu thuẫn / lựa chọn lạ — không xác định được đề nghị công trình hay phòng ban.",
      };
    }
    const kq = await guiSangThuMua(payload);
    if (kq.ok) {
      return {
        loai: "thanh_cong",
        ketQua: kq.trangThai || "da_gui",
        nhatKy: { action: "Đã đồng bộ sang App Thu mua", note: `Mã đề nghị: ${kq.maDeNghi ?? "—"}` },
      };
    }
    return { loai: "loi", error: kq.error, httpStatus: kq.httpStatus, loaiLoiBenNhan: kq.loaiLoi };
  }

  // Sự kiện sau duyệt — ký lại link file MỖI LẦN gửi (link chỉ sống 5 phút).
  let taiLieu: { ten: string; url: string }[] = [];
  if (viec.taiLieu.length) {
    try {
      taiLieu = await Promise.all(
        viec.taiLieu.map(async (f) => ({ ten: f.name, url: await createSignedReadUrl(f.path) })),
      );
    } catch (err) {
      return { loai: "loi", error: `Không ký được link file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const kq = await guiCapNhatSuKien(viec.dich, {
    suKienId: viec.id,
    requestId: viec.requestId,
    ...(viec.requestCode ? { requestCode: viec.requestCode } : {}),
    loai: viec.loai,
    luc: viec.lucSuKien,
    ...(viec.nguoi ? { nguoi: viec.nguoi } : {}),
    ...(viec.noiDung ? { noiDung: viec.noiDung } : {}),
    ...(taiLieu.length ? { taiLieu } : {}),
  });
  if (kq.ok) {
    return {
      loai: "thanh_cong",
      ketQua: kq.trangThai,
      nhatKy: {
        action: `Đã báo ${NHAN_DICH[viec.dich]}: ${NHAN_LOAI[viec.loai]}`,
        note: [moTaKetQua(kq.trangThai), kq.canhBao].filter(Boolean).join(" · ") || undefined,
      },
    };
  }
  return { loai: "loi", error: kq.error, httpStatus: kq.httpStatus, loaiLoiBenNhan: kq.loaiLoi };
}

function moTaKetQua(trangThai: string): string {
  const m: Record<string, string> = {
    da_an: "đề nghị chưa có PO / chưa nhập kho nên đã ẩn",
    giu_nhan_do: "đề nghị đã có PO hoặc đã nhập kho nên vẫn giữ, gắn nhãn đỏ",
    da_khoi_phuc: "đã hiện lại đề nghị",
    da_ghi_dieu_chinh: "đã ghi nội dung điều chỉnh",
    da_them_tai_lieu: "đã lưu tài liệu",
    da_xu_ly_truoc: "đã nhận từ trước",
    khong_co_de_nghi: "app này không có đề nghị của đề xuất này — không cần cập nhật",
    // Thu mua
    da_chuyen_that_bai: "hồ sơ đã chuyển sang Thất bại, đơn hàng (nếu có) giữ nguyên + báo Trưởng bộ phận",
    giu_nguyen: "hồ sơ đã Hoàn thành / Thất bại vì lý do khác nên giữ nguyên",
  };
  return m[trangThai] ?? trangThai;
}

function coDongBo(viec: ViecDongBo): "qlkCtrSyncStatus" | "thuMuaSyncStatus" {
  return viec.dich === "kho" ? "qlkCtrSyncStatus" : "thuMuaSyncStatus";
}

async function ghiLichSuDeXuat(requestId: string, entry: RequestHistoryEntry, them: Record<string, unknown> = {}) {
  try {
    // arrayUnion = nối thêm nguyên tử, không ghi đè mảng (tránh mất dòng khi có thao tác song song).
    await adminDb.collection("requests").doc(requestId).update({ history: FieldValue.arrayUnion(entry), ...them });
  } catch (err) {
    console.error(`[hang-cho] ghi lịch sử đề xuất ${requestId} lỗi:`, err);
  }
}

export type KetQuaGuiViec = "da_gui" | "cho" | "dung" | "huy" | "bo_qua";

/**
 * Gửi 1 việc nếu đã tới hạn. Giữ "khoá" trong giao dịch trước khi gửi để 2 lượt quét chạy song song
 * không gửi trùng.
 */
export async function guiViec(id: string, opts: { boQuaHen?: boolean } = {}): Promise<KetQuaGuiViec> {
  const ref = adminDb.collection(COL).doc(id);
  const bayGio = Date.now();

  const viec = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const v = docViec(snap);
    if (!denHanGui(v, bayGio, opts.boQuaHen)) return null;
    tx.update(ref, { khoaDen: bayGio + THOI_GIAN_KHOA_MS });
    return v;
  });
  if (!viec) return "bo_qua";

  // Đúng thứ tự: việc trước của cùng đề xuất + cùng app đích chưa xong thì việc này đợi.
  const cung = await adminDb.collection(COL).where("requestId", "==", viec.requestId).get();
  const tatCa = cung.docs.map(docViec);
  if (biChanBoiViecTruoc(viec, tatCa)) {
    const quaHan = bayGio - (viec.hanDungTu ?? viec.taoLuc) >= HAN_DUNG_MS;
    await ref.update({
      khoaDen: 0,
      capNhatLuc: bayGio,
      ...(quaHan
        ? {
            trangThai: "dung",
            dungDoChan: true,
            henLuc: FieldValue.delete(),
            loi: "Chờ việc trước của đề xuất này quá 1 ngày — dừng; việc trước gửi xong sẽ tự chạy lại",
          }
        : // Dời hẹn 5 phút: việc bị chặn có `henLuc` cũ nhất, để nguyên thì lượt quét (lấy theo
          // `henLuc` tăng dần, giới hạn 5 việc) cứ bốc lại nó và bỏ đói các việc khác.
          { henLuc: bayGio + 300_000, loi: "Đang chờ việc trước của đề xuất này gửi xong" }),
    });
    return quaHan ? "dung" : "bo_qua";
  }

  let kq: KetQuaThucHien;
  try {
    kq = await thucHien(viec);
  } catch (err) {
    kq = { loai: "loi", error: err instanceof Error ? err.message : String(err) };
  }
  const xong = Date.now();
  const tenDeXuat = viec.requestCode ? `đề xuất ${viec.requestCode}` : "đề xuất";

  if (kq.loai === "thanh_cong") {
    await ref.update({
      trangThai: "da_gui",
      henLuc: FieldValue.delete(),
      khoaDen: 0,
      soLanThu: viec.soLanThu + 1,
      ketQua: kq.ketQua,
      loi: null,
      loaiLoi: null,
      xongLuc: xong,
      capNhatLuc: xong,
    });
    // Việc sau (cùng đề xuất + cùng app đích) đã bị dừng CHỈ VÌ chờ việc này → cho chạy lại luôn.
    const choChayLai = tatCa.filter(
      (v) => v.id !== viec.id && v.dich === viec.dich && v.trangThai === "dung" && v.dungDoChan,
    );
    for (const v of choChayLai) {
      await adminDb.collection(COL).doc(v.id).update({
        trangThai: "cho",
        dungDoChan: false,
        hanDungTu: xong,
        henLuc: xong,
        khoaDen: 0,
        loi: null,
        capNhatLuc: xong,
      });
    }
    await ghiLichSuDeXuat(
      viec.requestId,
      {
        at: new Date(xong).toISOString(),
        actor: "Hệ thống",
        action: viec.soLanThu > 0 ? `${kq.nhatKy.action} (gửi lại lần ${viec.soLanThu + 1})` : kq.nhatKy.action,
        ...(kq.nhatKy.note ? { note: kq.nhatKy.note } : {}),
      },
      viec.loai === "duyet" ? { [coDongBo(viec)]: "synced" } : {},
    );
    return "da_gui";
  }

  if (kq.loai === "huy") {
    await ref.update({
      trangThai: "huy",
      henLuc: FieldValue.delete(),
      khoaDen: 0,
      loi: kq.lyDo,
      capNhatLuc: xong,
      ...(kq.doXoa ? { huyDoXoa: true } : {}),
    });
    return "huy";
  }

  const soLanThu = viec.soLanThu + 1;
  const loaiLoi = phanLoaiLoi(kq.httpStatus, kq.loaiLoiBenNhan);
  const qd = quyetDinhSauLoi({ soLanThu, taoLuc: viec.hanDungTu ?? viec.taoLuc, bayGio: xong, loaiLoi });
  if (qd.trangThai === "cho") {
    await ref.update({ soLanThu, henLuc: qd.henLuc, khoaDen: 0, loi: kq.error, loaiLoi, capNhatLuc: xong });
    return "cho";
  }
  await ref.update({
    trangThai: "dung",
    henLuc: FieldValue.delete(),
    khoaDen: 0,
    soLanThu,
    loi: `${kq.error} — ${qd.lyDo}`,
    loaiLoi,
    capNhatLuc: xong,
  });
  // "Báo người phụ trách": ghi vào lịch sử đề xuất + hiện ở trang "Lịch sử Webhook" (Admin).
  await ghiLichSuDeXuat(
    viec.requestId,
    {
      at: new Date(xong).toISOString(),
      actor: "Hệ thống",
      action: `⚠ Đồng bộ ${NHAN_DICH[viec.dich]} thất bại — đã dừng (${NHAN_LOAI[viec.loai]})`,
      note: `${kq.error}. ${qd.lyDo}. Admin xem và bấm "Gửi lại ngay" ở trang Lịch sử Webhook sau khi khắc phục (${tenDeXuat}).`,
    },
    viec.loai === "duyet" ? { [coDongBo(viec)]: "dung" } : {},
  );
  return "dung";
}

/** Gửi lần lượt các việc vừa tạo — gọi trong `after()` sau khi đã trả response. */
export async function guiCacViec(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await guiViec(id);
    } catch (err) {
      console.error(`[hang-cho] gửi việc ${id} lỗi:`, err);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// QUÉT GỬI LẠI
// ------------------------------------------------------------------------------------------------

let lanQuetGanNhat = 0;
const NHIP_QUET_MS = 60_000;
const SO_VIEC_MOI_LUOT = 5;

/**
 * Gửi lại các việc đã tới hạn — gọi kèm API người dùng hay mở. Tối đa 1 lần/phút/máy chủ để không
 * tốn lượt đọc (mỗi lượt quét tốn ít nhất 1 lượt đọc dù không có việc nào).
 */
export async function quetViecToiHan(): Promise<void> {
  const bayGio = Date.now();
  if (bayGio - lanQuetGanNhat < NHIP_QUET_MS) return;
  lanQuetGanNhat = bayGio;
  try {
    const snap = await adminDb
      .collection(COL)
      .where("henLuc", "<=", bayGio)
      .orderBy("henLuc")
      .limit(SO_VIEC_MOI_LUOT)
      .get();
    for (const d of snap.docs) await guiViec(d.id);
  } catch (err) {
    console.error("[hang-cho] quét việc tới hạn lỗi:", err);
  }
}

/** Cron 2:00 sáng: vét MỌI việc còn chờ (bỏ qua giờ hẹn), việc quá 1 ngày vẫn lỗi thì dừng + báo. */
export async function quetHangDem(): Promise<{ daXet: number; ketQua: Record<KetQuaGuiViec, number> }> {
  const snap = await adminDb.collection(COL).where("trangThai", "==", "cho").limit(200).get();
  const dem: Record<KetQuaGuiViec, number> = { da_gui: 0, cho: 0, dung: 0, huy: 0, bo_qua: 0 };
  // Cũ trước, mới sau — để việc "duyệt" đi trước việc "điều chỉnh" của cùng đề xuất.
  const ds = snap.docs.map(docViec).sort((a, b) => a.taoLuc - b.taoLuc);
  for (const v of ds) {
    try {
      dem[await guiViec(v.id, { boQuaHen: true })]++;
    } catch (err) {
      console.error(`[hang-cho] quét đêm việc ${v.id} lỗi:`, err);
    }
  }
  return { daXet: ds.length, ketQua: dem };
}

// ------------------------------------------------------------------------------------------------
// XEM / GỬI LẠI TAY
// ------------------------------------------------------------------------------------------------

/** "Gửi lại ngay" (Admin) — đặt lại đếm lần thử rồi gửi luôn. Chỉ áp dụng việc đã dừng / đang chờ. */
export async function guiLaiNgay(id: string): Promise<KetQuaGuiViec | "khong_hop_le"> {
  const ref = adminDb.collection(COL).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return "khong_hop_le";
  const v = docViec(snap);
  if (v.trangThai !== "dung" && v.trangThai !== "cho") return "khong_hop_le";
  const bayGio = Date.now();
  // 🔴 KHÔNG đặt lại `taoLuc` (QA 03/10): `taoLuc` là mốc xếp thứ tự — đặt lại thì việc "duyet" vừa
  // gửi lại bị xếp SAU việc "điều chỉnh" đang chờ, điều chỉnh tới trước khi app đích có đề nghị và
  // mất hẳn. Chỉ đặt lại mốc tính hạn 1 ngày (`hanDungTu`).
  await ref.update({ trangThai: "cho", soLanThu: 0, hanDungTu: bayGio, henLuc: bayGio, khoaDen: 0, loi: null, capNhatLuc: bayGio });
  return guiViec(id);
}

export async function layViecCuaDeXuat(requestId: string): Promise<ViecDongBo[]> {
  const snap = await adminDb.collection(COL).where("requestId", "==", requestId).get();
  return snap.docs.map(docViec).sort((a, b) => a.taoLuc - b.taoLuc);
}

/**
 * Danh sách cho trang "Lịch sử Webhook".
 *   · "dung" / "cho": ít việc, lấy HẾT bằng lọc bằng (chỉ mục 1 trường) — không được sót việc đã dừng
 *     nằm cũ.
 *   · "da_gui" / "huy" / tất cả: nhiều dần theo thời gian → lấy N việc cập nhật GẦN NHẤT rồi lọc
 *     (lọc bằng + sắp theo trường khác cần chỉ mục ghép, tránh — QA 03/10).
 */
export async function layViecGanDay(trangThai?: TrangThaiViec, gioiHan = 100): Promise<ViecDongBo[]> {
  if (trangThai === "dung" || trangThai === "cho") {
    const snap = await adminDb.collection(COL).where("trangThai", "==", trangThai).limit(500).get();
    return snap.docs
      .map(docViec)
      .sort((a, b) => b.capNhatLuc - a.capNhatLuc)
      .slice(0, gioiHan);
  }
  const snap = await adminDb.collection(COL).orderBy("capNhatLuc", "desc").limit(trangThai ? gioiHan * 3 : gioiHan).get();
  return snap.docs
    .map(docViec)
    .filter((v) => !trangThai || v.trangThai === trangThai)
    .slice(0, gioiHan);
}
