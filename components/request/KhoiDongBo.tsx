"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Webhook } from "lucide-react";

/**
 * ★ Khối "Đồng bộ sang Kho / Thu mua" trong chi tiết đề xuất — đợt 1 "liên kết 4 app" (03/10/2026).
 *
 * Mỗi thao tác sau duyệt (duyệt xong, xoá, khôi phục, điều chỉnh, thêm tài liệu) sinh 1 việc cho mỗi
 * app đích trong hàng chờ (lib/dong-bo/hang-cho.ts). Khối này cho người xem đề xuất biết từng việc đã
 * tới nơi chưa; việc đã DỪNG thì Owner / Admin bấm "Gửi lại ngay" sau khi khắc phục.
 */

type Viec = {
  id: string;
  dich: "kho" | "thumua";
  loai: "duyet" | "xoa" | "khoi_phuc" | "dieu_chinh" | "them_file";
  trangThai: "cho" | "da_gui" | "dung" | "huy";
  soLanThu: number;
  taoLuc: number;
  henLuc: number | null;
  xongLuc: number | null;
  loi: string | null;
};

const NHAN_LOAI: Record<Viec["loai"], string> = {
  duyet: "Gửi đề nghị",
  xoa: "Xoá đề xuất",
  khoi_phuc: "Khôi phục",
  dieu_chinh: "Điều chỉnh sau duyệt",
  them_file: "Thêm tài liệu",
};
const NHAN_DICH: Record<Viec["dich"], string> = { kho: "App Kho", thumua: "App Thu mua" };

function gio(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—";
}

function NhanTrangThai({ v }: { v: Viec }) {
  if (v.trangThai === "da_gui")
    return (
      <span className="rounded bg-green-50 px-1.5 py-0.5 text-[12px] font-medium text-green-700">
        ✓ Đã nhận{v.soLanThu > 1 ? ` (lần ${v.soLanThu})` : ""} · {gio(v.xongLuc)}
      </span>
    );
  if (v.trangThai === "dung")
    return <span className="rounded bg-red-50 px-1.5 py-0.5 text-[12px] font-medium text-red-700">⚠ Đã dừng — cần xử lý</span>;
  if (v.trangThai === "huy")
    return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px] font-medium text-gray-500">Không cần gửi</span>;
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[12px] font-medium text-amber-700">
      ⏳ Đang chờ{v.soLanThu > 0 ? ` gửi lại (lần ${v.soLanThu + 1}/5, hẹn ${gio(v.henLuc)})` : " gửi"}
    </span>
  );
}

export default function KhoiDongBo({ requestId, lamMoiKhi }: { requestId: string; lamMoiKhi: number }) {
  const [viec, setViec] = useState<Viec[] | null>(null);
  const [coTheGuiLai, setCoTheGuiLai] = useState(false);
  const [dangGui, setDangGui] = useState<string | null>(null);
  const [thongBao, setThongBao] = useState<string | null>(null);

  const tai = useCallback(async () => {
    try {
      const res = await fetch(`/api/requests/${requestId}/dong-bo`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { viec: Viec[]; coTheGuiLai: boolean };
      setViec(data.viec);
      setCoTheGuiLai(data.coTheGuiLai);
    } catch {
      // Khối phụ — lỗi tải thì để trống, không làm hỏng trang chi tiết.
    }
  }, [requestId]);

  useEffect(() => {
    void tai();
    // Việc vừa tạo được gửi ngay sau khi trả kết quả — hỏi lại sau vài giây để thấy "Đã nhận".
    const t = setTimeout(() => void tai(), 6000);
    return () => clearTimeout(t);
  }, [tai, lamMoiKhi]);

  async function guiLai(id: string) {
    setDangGui(id);
    setThongBao(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/dong-bo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viecId: id }),
      });
      const data = (await res.json()) as { viec?: Viec[]; ketQua?: string; error?: string };
      if (!res.ok) {
        setThongBao(data.error ?? "Gửi lại thất bại.");
      } else {
        if (data.viec) setViec(data.viec);
        setThongBao(data.ketQua === "da_gui" ? "Gửi lại thành công." : "Vẫn lỗi — đã xếp lại vào hàng chờ gửi lại.");
      }
    } catch {
      setThongBao("Không kết nối được máy chủ.");
    } finally {
      setDangGui(null);
    }
  }

  if (!viec || viec.length === 0) return null;

  // Việc gần nhất của từng app đích lên trên cùng, CỘNG mọi việc đã dừng (QA 03/10: việc "gửi đề nghị"
  // đã dừng không được bị việc sau che mất nút "Gửi lại ngay"); còn lại gấp trong "Xem tất cả".
  const ganNhatMoiApp = (["kho", "thumua"] as const)
    .map((d) => viec.filter((v) => v.dich === d && v.trangThai !== "huy").at(-1))
    .filter((v): v is Viec => !!v);
  const ganNhat = [
    ...viec.filter((v) => v.trangThai === "dung" && !ganNhatMoiApp.some((g) => g.id === v.id)),
    ...ganNhatMoiApp,
  ];
  const coDung = viec.some((v) => v.trangThai === "dung");

  return (
    <div id="khoi-dong-bo" className="rounded-[3px] border border-[var(--color-border)] bg-white p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
        <Webhook size={13} /> Đồng bộ sang Kho / Thu mua
        <button
          type="button"
          onClick={() => void tai()}
          title="Tải lại"
          aria-label="Tải lại tình trạng đồng bộ"
          className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
        >
          <RefreshCw size={12} />
        </button>
      </h3>

      {coDung && (
        <p className="mb-2 rounded-r border-l-[3px] border-red-400 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700">
          Có việc đã dừng vì gửi lỗi quá số lần cho phép. {coTheGuiLai ? "Khắc phục xong bấm \"Gửi lại ngay\"." : "Đã báo Admin xử lý."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {ganNhat.length === 0 && <p className="text-[12px] text-gray-400">Đề xuất này không thuộc diện gửi sang Kho / Thu mua.</p>}
        {ganNhat.map((v) => (
          <div key={v.id} className="text-[12px]">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-gray-700">{NHAN_DICH[v.dich]}</span>
              <span className="text-gray-400">· {NHAN_LOAI[v.loai]}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <NhanTrangThai v={v} />
              {v.trangThai === "dung" && coTheGuiLai && (
                <button
                  type="button"
                  disabled={dangGui === v.id}
                  onClick={() => void guiLai(v.id)}
                  className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {dangGui === v.id ? "Đang gửi..." : "Gửi lại ngay"}
                </button>
              )}
            </div>
            {v.loi && v.trangThai !== "da_gui" && <p className="mt-0.5 text-[12px] text-gray-400">{v.loi}</p>}
          </div>
        ))}
      </div>

      {thongBao && <p className="mt-2 text-[12px] text-gray-600">{thongBao}</p>}

      {viec.length > ganNhat.length && (
        <details className="mt-3 text-[12px] text-gray-500">
          <summary className="cursor-pointer select-none">Xem tất cả ({viec.length} việc)</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {viec
              .slice()
              .reverse()
              .map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-gray-600">
                    {NHAN_DICH[v.dich]} · {NHAN_LOAI[v.loai]} · {gio(v.taoLuc)}
                  </span>
                  <NhanTrangThai v={v} />
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
