import type { RequestStatus } from "@/lib/types";

const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Đã lưu nháp",
  pending: "Đang chờ duyệt",
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  returned: "Đã trả lại",
};

const STATUS_CLASS: Record<RequestStatus, string> = {
  draft: "bg-gray-100 text-gray-500",
  pending: "bg-amber-50 text-amber-600",
  approved: "bg-emerald-50 text-[var(--color-confirm-green)]",
  rejected: "bg-red-50 text-[var(--color-danger-red)]",
  returned: "bg-orange-50 text-orange-600",
};

export default function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
