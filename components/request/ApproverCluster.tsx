import { Check, X } from "lucide-react";
import Avatar from "@/components/request/Avatar";
import type { RequestInstance } from "@/lib/types";

/** Cụm avatar người duyệt (tối đa 3 + "+N"), mỗi avatar có chấm quyết định
 * nhỏ đè góc: ✓ xanh đã duyệt / ✕ đỏ từ chối / xám đang chờ — icon kèm màu
 * (không chỉ dựa màu).
 *
 * Tách ra từ app/request/list/page.tsx (14/09/2026, change
 * add-request-home-base-layout) để dùng chung với Trang chủ (/request).
 */
export default function ApproverCluster({
  request,
  avatars,
}: {
  request: RequestInstance;
  avatars: Record<string, string | null>;
}) {
  if (request.approversSnapshot.length === 0) return null;
  const decisionById = new Map(request.approvers.map((a) => [a.id, a.decision]));
  const shown = request.approversSnapshot.slice(0, 3);
  const extra = request.approversSnapshot.length - shown.length;
  return (
    // Tách rời từng người, có khoảng cách — KHÔNG chồng avatar lên nhau
    // (Sếp góp ý 17/08/2026 sau khi xem bản đầu).
    <span className="flex items-center gap-1.5">
      {shown.map((user) => {
        const decision = decisionById.get(user.id) ?? "pending";
        return (
          <span
            key={user.id}
            className="relative"
            title={`${user.name} — ${decision === "approved" ? "đã duyệt" : decision === "rejected" ? "từ chối" : "đang chờ"}`}
          >
            <Avatar
              url={avatars[user.id]}
              initial={user.avatarInitial || user.name.charAt(0).toUpperCase()}
              size={24}
              fallbackClassName="bg-gray-200 text-gray-600"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 flex h-[11px] w-[11px] items-center justify-center rounded-full ring-1 ring-white ${
                decision === "approved" ? "bg-emerald-500" : decision === "rejected" ? "bg-red-500" : "bg-gray-300"
              }`}
            >
              {decision === "approved" && <Check size={8} strokeWidth={3.5} className="text-white" />}
              {decision === "rejected" && <X size={8} strokeWidth={3.5} className="text-white" />}
            </span>
          </span>
        );
      })}
      {extra > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[12px] font-semibold text-gray-500">
          +{extra}
        </span>
      )}
    </span>
  );
}
