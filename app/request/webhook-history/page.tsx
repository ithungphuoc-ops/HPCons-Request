"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import type { ListLoadStatus } from "@/lib/types";

/**
 * ★ Lịch sử Webhook — đợt 1 "liên kết 4 app" (Sếp chốt 03/10/2026). Trước đây là trang trống.
 *
 * Mọi việc App Request tự báo sang App Kho / App Thu mua (duyệt xong, xoá, khôi phục, điều chỉnh sau
 * duyệt, thêm tài liệu) — đang chờ, đã gửi, đã dừng. Việc ĐÃ DỪNG là chỗ "báo người phụ trách": Admin
 * khắc phục nguyên nhân (vd thêm công trình bên Kho) rồi bấm "Gửi lại ngay".
 */

type Viec = {
  id: string;
  requestId: string;
  requestCode: string | null;
  dich: "kho" | "thumua";
  loai: "duyet" | "xoa" | "khoi_phuc" | "dieu_chinh" | "them_file";
  nguoi: string | null;
  trangThai: "cho" | "da_gui" | "dung" | "huy";
  soLanThu: number;
  taoLuc: number;
  henLuc: number | null;
  xongLuc: number | null;
  capNhatLuc: number;
  loi: string | null;
};

const NHAN_LOAI: Record<Viec["loai"], string> = {
  duyet: "Gửi đề nghị (duyệt xong)",
  xoa: "Xoá đề xuất",
  khoi_phuc: "Khôi phục",
  dieu_chinh: "Điều chỉnh sau duyệt",
  them_file: "Thêm tài liệu",
};
const NHAN_DICH: Record<Viec["dich"], string> = { kho: "App Kho", thumua: "App Thu mua" };
const BO_LOC: { v: "" | Viec["trangThai"]; nhan: string }[] = [
  { v: "dung", nhan: "Đã dừng — cần xử lý" },
  { v: "cho", nhan: "Đang chờ gửi" },
  { v: "da_gui", nhan: "Đã gửi" },
  { v: "", nhan: "Tất cả (gần đây)" },
];

function gio(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString("vi-VN") : "—";
}

function NhanTrangThai({ v }: { v: Viec }) {
  if (v.trangThai === "da_gui")
    return <span className="rounded bg-green-50 px-1.5 py-0.5 text-[12px] font-medium text-green-700">Đã gửi{v.soLanThu > 1 ? ` (lần ${v.soLanThu})` : ""}</span>;
  if (v.trangThai === "dung")
    return <span className="rounded bg-red-50 px-1.5 py-0.5 text-[12px] font-medium text-red-700">Đã dừng</span>;
  if (v.trangThai === "huy")
    return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px] font-medium text-gray-500">Không cần gửi</span>;
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[12px] font-medium text-amber-700">
      Chờ gửi{v.soLanThu > 0 ? ` lại · lần ${v.soLanThu + 1}/5 · hẹn ${gio(v.henLuc)}` : ""}
    </span>
  );
}

export default function WebhookHistoryPage() {
  return (
    <RequireAdminRole>
      <WebhookHistoryInner />
    </RequireAdminRole>
  );
}

function WebhookHistoryInner() {
  const [loc, setLoc] = useState<"" | Viec["trangThai"]>("dung");
  const [viec, setViec] = useState<Viec[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");
  const [dangGui, setDangGui] = useState<string | null>(null);
  const [thongBao, setThongBao] = useState<string | null>(null);

  const tai = useCallback(() => {
    setStatus("loading");
    fetch(`/api/dong-bo${loc ? `?trangThai=${loc}` : ""}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { viec: Viec[] }) => {
        setViec(data.viec ?? []);
        setStatus(data.viec?.length ? "loaded" : "empty");
      })
      .catch(() => setStatus("error"));
  }, [loc]);

  useEffect(tai, [tai]);

  async function guiLai(v: Viec) {
    setDangGui(v.id);
    setThongBao(null);
    try {
      const res = await fetch(`/api/requests/${v.requestId}/dong-bo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viecId: v.id }),
      });
      const data = (await res.json()) as { ketQua?: string; error?: string };
      setThongBao(
        !res.ok
          ? (data.error ?? "Gửi lại thất bại.")
          : data.ketQua === "da_gui"
            ? `Đã gửi lại thành công — ${NHAN_DICH[v.dich]} · đề xuất ${v.requestCode ?? ""}.`
            : "Vẫn lỗi — đã xếp lại vào hàng chờ gửi lại.",
      );
      tai();
    } catch {
      setThongBao("Không kết nối được máy chủ.");
    } finally {
      setDangGui(null);
    }
  }

  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">Lịch sử Webhook</h1>
      <p className="mt-1 max-w-3xl text-[14px] text-gray-500">
        Những gì App Request tự báo sang App Kho và App Thu mua. Gửi lỗi thì tự gửi lại theo lịch 1 phút · 5 phút ·
        30 phút · 2 giờ; quá 5 lần hoặc quá 1 ngày thì <b className="font-semibold text-gray-700">dừng</b> và nằm ở mục
        &quot;Đã dừng&quot; dưới đây — khắc phục xong bấm &quot;Gửi lại ngay&quot;.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {BO_LOC.map((b) => (
          <button
            key={b.v || "all"}
            type="button"
            onClick={() => setLoc(b.v)}
            className={`rounded-[3px] border px-3 py-1.5 text-[13px] ${
              loc === b.v
                ? "border-[var(--color-action-blue)] bg-[var(--color-action-blue)] text-white"
                : "border-[var(--color-border)] bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {b.nhan}
          </button>
        ))}
        <button
          type="button"
          onClick={tai}
          className="ml-auto inline-flex items-center gap-1 rounded-[3px] border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={13} /> Tải lại
        </button>
      </div>

      {thongBao && <p className="mt-3 text-[14px] text-gray-700">{thongBao}</p>}
      {status === "loading" && <p className="mt-6 text-[14px] text-gray-400">Đang tải...</p>}
      {status === "error" && <p className="mt-6 text-[14px] text-[var(--color-danger-red)]">Không tải được danh sách.</p>}
      {status === "empty" && (
        <div className="mt-6 flex min-h-[160px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white">
          <p className="text-[14px] text-gray-400">{loc === "dung" ? "Không có việc nào bị dừng. 👍" : "Chưa có việc nào."}</p>
        </div>
      )}

      {status === "loaded" && (
        <div className="mt-4 overflow-x-auto rounded-[3px] border border-[var(--color-border)] bg-white">
          <table className="w-full min-w-[860px] text-[14px]">
            <thead className="bg-gray-50 text-left text-[12px] text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Đề xuất</th>
                <th className="px-4 py-2 font-medium">Gửi tới</th>
                <th className="px-4 py-2 font-medium">Sự kiện</th>
                <th className="px-4 py-2 font-medium">Tình trạng</th>
                <th className="px-4 py-2 font-medium">Cập nhật</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {viec.map((v) => (
                <tr key={v.id} className={`border-t border-gray-100 align-top ${v.trangThai === "dung" ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/request/requests/${v.requestId}`} className="font-medium text-[var(--color-action-blue)] hover:underline">
                      {v.requestCode ?? v.requestId.slice(0, 8)}
                    </Link>
                    {v.nguoi && <p className="text-[12px] text-gray-400">{v.nguoi}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{NHAN_DICH[v.dich]}</td>
                  <td className="px-4 py-2.5 text-gray-700">{NHAN_LOAI[v.loai]}</td>
                  <td className="px-4 py-2.5">
                    <NhanTrangThai v={v} />
                    {v.loi && v.trangThai !== "da_gui" && <p className="mt-1 max-w-md text-[12px] text-gray-500">{v.loi}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-gray-500">{gio(v.capNhatLuc)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {v.trangThai === "dung" && (
                      <button
                        type="button"
                        onClick={() => void guiLai(v)}
                        disabled={dangGui === v.id}
                        className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-white px-2.5 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        <Send size={12} /> {dangGui === v.id ? "Đang gửi..." : "Gửi lại ngay"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
