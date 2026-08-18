/**
 * Đánh số "Luồng duyệt 1/2/3..." cho các bước duyệt kind "submitter_manager"
 * trong 1 đề xuất (yêu cầu Sếp 18/08/2026) — trước đây mọi bước loại này
 * đều hiện chung nhãn "Quản lý trực tiếp" giống hệt nhau, không phân biệt
 * được khi nhóm có nhiều bước cùng loại.
 *
 * Tách thành hàm thuần riêng (không nằm trong component) để: (1) test được
 * độc lập không cần render React, (2) dùng lại được ở nơi khác nếu sau này
 * cần hiển thị "Luồng duyệt N" (vd trang chi tiết, mẫu in) mà không phải
 * chép lại logic.
 *
 * CHỈ đếm bước kind === "submitter_manager". resolveApproverStepsDetailed
 * (lib/server/requests.ts) gán `index` dùng CHUNG 1 dãy số cho cả "fixed"
 * lẫn "submitter_manager" (index = vị trí trong mảng applicableSteps sau
 * lọc điều kiện) — nếu đếm luôn cả "fixed" thì số nhảy cóc khi 2 loại bước
 * xen kẽ nhau (bug thật phát hiện qua code review 18/08/2026, xem
 * lib/server/conditions.test.ts:392-408 — cấu hình xen kẽ có thật, không
 * phải giả thuyết).
 */
export function computeManagerFlowNumbers(
  steps: readonly { index: number; kind: string }[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const s of steps) {
    if (s.kind === "submitter_manager" && !map.has(s.index)) {
      map.set(s.index, map.size + 1);
    }
  }
  return map;
}
