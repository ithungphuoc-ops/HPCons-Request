import { STATUS_LABEL } from "@/components/request/RequestStatusBadge";
import { resolveRequestTitle } from "@/lib/request-title";
import { notableFieldParts } from "@/lib/request-list-format";
import type { RequestInstance } from "@/lib/types";

/**
 * Xuất 1 mảng đề xuất (đã lọc theo đúng bộ lọc/tab đang xem) ra file
 * Excel .xlsx — thư viện tải lười lúc bấm, không cộng vào bundle lúc mở
 * trang.
 *
 * Tách ra từ app/request/list/page.tsx (14/09/2026, change
 * add-request-home-base-layout) để dùng chung với Trang chủ (/request) —
 * tránh 2 bộ logic xuất Excel lệch cột nhau nếu sửa 1 chỗ mà quên chỗ kia.
 */
export async function exportRequestsToExcel(requests: RequestInstance[]): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = requests.map((r) => ({
    "Tên đề xuất": resolveRequestTitle(r),
    Nhóm: r.groupNameSnapshot,
    "Thông tin": notableFieldParts(r).join(" · "),
    "Người gửi": r.submittedBy.name,
    "Người duyệt": r.approversSnapshot.map((a) => a.name).join(", "),
    "Trạng thái": STATUS_LABEL[r.status],
    Ngày: new Date(r.status === "draft" ? (r.updatedAt ?? r.submittedAt) : r.submittedAt).toLocaleDateString("vi-VN"),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 32 }, { wch: 22 }, { wch: 48 }, { wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 11 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Đề xuất");
  XLSX.writeFile(wb, `danh-sach-de-xuat-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
