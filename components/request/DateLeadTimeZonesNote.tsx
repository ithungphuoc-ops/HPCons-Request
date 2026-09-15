"use client";

import {
  DATE_LEAD_TIME_FOOTNOTE,
  dateLeadTimeZones,
  type DateLeadTimeZoneKind,
} from "@/lib/date-lead-time";

/**
 * Khối "luật ngày" chia theo vùng — DÙNG CHUNG cho 2 nơi:
 *   1. Hộp thiết lập của Admin (AddFieldModal) — xem trước luật mình vừa đặt.
 *   2. Ngay dưới ô "Ngày đề nghị cấp" trên phiếu gửi, khi người gửi chọn phải
 *      ngày bị chặn.
 *
 * ★ Sếp yêu cầu 15/09/2026, nguyên văn: *"ngoài phiếu đề nghị sẽ ra thông báo
 * như trong thiết lập"*. Lần đầu tôi tự rút gọn phần hiện cho người gửi thành
 * MỘT CÂU — sai với yêu cầu, Sếp bắt lỗi. Nay hai nơi dùng ĐÚNG MỘT component
 * nên không thể lệch nhau nữa, kể cả về cách bày.
 *
 * `tone` chỉ đổi màu: vàng ở hộp thiết lập (đang xem trước), đỏ dưới ô ngày
 * (đang thật sự bị chặn).
 */
export function DateLeadTimeZonesNote({
  rule,
  tone = "amber",
}: {
  rule?: { blockDays?: number; standardDays?: number } | null;
  tone?: "amber" | "danger";
}) {
  const vungs = dateLeadTimeZones(rule);
  const mau =
    tone === "danger"
      ? { nen: "bg-red-50", chu: "text-[var(--color-danger-red)]", vien: "border-red-200", chan: "text-red-500" }
      : { nen: "bg-amber-50", chu: "text-amber-700", vien: "border-amber-300", chan: "text-amber-600" };
  const dauVung: Record<DateLeadTimeZoneKind, { ky: string; nen: string }> = {
    blocked: { ky: "✕", nen: "bg-[var(--color-danger-red)]" },
    urgent: { ky: "!", nen: "bg-amber-600" },
    ok: { ky: "✓", nen: "bg-[var(--color-confirm-green)]" },
  };

  return (
    <div className={`rounded-md ${mau.nen} p-2.5 text-[12px] leading-relaxed ${mau.chu}`}>
      <div className="flex flex-col gap-1.5">
        {vungs.map((vung) => (
          <div key={vung.kind} className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white ${dauVung[vung.kind].nen}`}
              aria-hidden
            >
              {dauVung[vung.kind].ky}
            </span>
            <span>
              <b>{vung.label}</b> — {vung.detail}
            </span>
          </div>
        ))}
      </div>
      <p className={`mt-2 border-t border-dashed ${mau.vien} pt-1.5 ${mau.chan}`}>
        {DATE_LEAD_TIME_FOOTNOTE}
      </p>
    </div>
  );
}
