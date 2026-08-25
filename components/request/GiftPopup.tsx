"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, RotateCw, ExternalLink, Home, type LucideIcon } from "lucide-react";

// hpcons-quacuatoi — hệ thống nhiệm vụ đổi điểm UrBox, một app riêng trong hệ
// sinh thái HP Cons (KHÔNG phải tính năng của app Đề xuất này).
const NHIEM_VU_URL = "https://quacuatoi.hpcore.vn/nhiem-vu";

function MucDieuHuong({
  icon: Icon,
  label,
  title,
  onClick,
  noiBat,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  noiBat?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors active:scale-95 ${
        noiBat ? "text-[var(--color-action-blue)]" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Popup khung điện thoại nhúng iframe app "Quà của tôi" (quacuatoi.hpcore.vn),
 * chuẩn thiết kế đồng bộ với hpcons-portal (components/layout/GiftPopup.tsx đã
 * duyệt qua nhiều vòng phản hồi thật) và hpcons-quatang (components/GiftPopup.tsx).
 *
 * KHÔNG có mục "Thông báo"/"Tôi" ở thanh điều hướng đáy — NotificationBell ở
 * đây là ô đổ xuống trong AppBar (không phải route riêng) và app Đề xuất chưa
 * có trang hồ sơ/tài khoản riêng, nên chỉ giữ 3 mục có route/hành vi thật:
 * Trang chủ, Làm mới, Mở tab đầy đủ (giống hpcons-quatang).
 *
 * Chỉ đóng bằng nút ✕ hoặc điều hướng có chủ đích ("Trang chủ") — không đóng
 * khi bấm ra ngoài, đúng chuẩn bản gốc hpcons-portal.
 */
export default function GiftPopup({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Focus vào khung dialog (không phải 1 nút ✕ cụ thể) — vì có 2 nút đóng khác
  // nhau tuỳ breakpoint (khung điện thoại desktop / thanh trên cùng di động),
  // nút bị ẩn bằng `hidden` không nhận được focus.
  const dialogRef = useRef<HTMLDivElement>(null);

  const veTrangChu = () => {
    onClose();
    router.push("/request");
  };

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      // Chỉ nút ✕ (hoặc điều hướng có chủ đích như "Trang chủ") mới đóng được
      // popup — không có onClick đóng khi bấm ra vùng nền tối.
      className="fixed inset-0 z-[60] flex items-center justify-center xl:p-4"
      style={{ background: "rgba(10, 14, 22, 0.6)", backdropFilter: "blur(3px)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quà của tôi"
        tabIndex={-1}
        className="relative shadow-2xl w-full h-full rounded-none p-0 outline-none xl:rounded-[3rem] xl:p-3.5 xl:w-[380px] xl:h-[min(800px,88vh)]"
        style={{ background: "linear-gradient(155deg, #2a3040, #12151c)" }}
      >
        {/* Nút đóng nổi ngoài khung — chỉ hợp lý khi có khung (desktop) */}
        <button
          onClick={onClose}
          aria-label="Đóng"
          className="hidden xl:flex absolute -top-3.5 -right-3.5 w-10 h-10 rounded-full bg-white text-gray-700 border border-gray-200 shadow-lg items-center justify-center hover:scale-105 transition-transform"
        >
          <X size={18} />
        </button>

        <div className="relative w-full h-full bg-white overflow-hidden flex flex-col rounded-none xl:rounded-[2.25rem]">
          {/* Thanh trên cùng — chỉ hiện ở chế độ toàn màn hình (điện thoại/tablet
              thật): thay cho tai thỏ trang trí, có tên popup + nút đóng thật. */}
          <div className="flex xl:hidden shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 bg-white">
            <span className="text-sm font-bold text-gray-800">🎁 Quà của tôi</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tai thỏ — chỉ hiện ở khung điện thoại giả (desktop), nằm trong dải
              riêng phía trên, không đè lên iframe */}
          <div className="relative h-11 shrink-0 bg-white hidden xl:block">
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[118px] h-[26px] rounded-full bg-[#12151c] flex items-center justify-end pr-2.5">
              <span className="w-2 h-2 rounded-full bg-[#2a3040]" />
            </div>
          </div>

          <iframe
            ref={iframeRef}
            src={NHIEM_VU_URL}
            title="Quà của tôi — nhiệm vụ đổi điểm"
            className="flex-1 w-full border-0"
            loading="lazy"
            // Giới hạn tối thiểu quyền của iframe (CodeRabbit khuyến nghị 25/08/2026, PR #5):
            // allow-same-origin để đọc được cookie phiên .hpcore.vn (bắt buộc, không thì mất
            // đăng nhập SSO), allow-scripts để chạy app React, allow-popups (+
            // allow-popups-to-escape-sandbox) vì bấm nhiệm vụ mở tab mới, allow-forms cho màn
            // đăng nhập lúc chưa có phiên. CỐ Ý bỏ allow-top-navigation — không cho iframe điều
            // hướng cả trang cha.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />

          {/* Thanh điều hướng đáy — 3 mục CÓ CHỨC NĂNG THẬT, dùng chung cho cả
              khung điện thoại giả (desktop) lẫn toàn màn hình (di động). "Mở tab
              đầy đủ" tô màu action-blue vì là hành động "thoát hẳn ra ngoài". */}
          <div className="grid grid-cols-3 shrink-0 border-t border-gray-100 bg-white">
            <MucDieuHuong icon={Home} label="Trang chủ" onClick={veTrangChu} />
            <MucDieuHuong
              icon={RotateCw}
              label="Làm mới"
              onClick={() => {
                if (iframeRef.current) iframeRef.current.src = NHIEM_VU_URL;
              }}
            />
            <MucDieuHuong
              icon={ExternalLink}
              label="Mở tab"
              title="Mở tab đầy đủ"
              noiBat
              onClick={() => window.open(NHIEM_VU_URL, "_blank", "noopener,noreferrer")}
            />
          </div>

          {/* Home indicator — trang trí, chỉ có ý nghĩa ở khung điện thoại giả (desktop) */}
          <div className="relative h-5 shrink-0 bg-white hidden xl:block">
            <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[120px] h-1 rounded-full bg-gray-900/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
