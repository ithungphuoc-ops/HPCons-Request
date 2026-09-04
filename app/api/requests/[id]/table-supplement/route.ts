import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canSupplementAfterApproval } from "@/lib/permissions";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import { deserializeTableRows, normalizeColumnName, toWireTableRows } from "@/lib/table-field";
import { TABLE_SUPPLEMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import type { RequestHistoryEntry, RequestInstance } from "@/lib/types";

interface TableSupplementBody {
  fieldId?: unknown;
  newRows?: unknown;
  newColumns?: unknown;
}

/**
 * Nối thêm dòng vào field kiểu "table"/"base_table" của 1 đề xuất ĐÃ DUYỆT —
 * tách hẳn khỏi `PATCH /api/requests/[id]` (route đó giữ nguyên chặn tuyệt
 * đối sửa `values` khi đã duyệt). Route này CHỈ cho nối thêm dòng, không có
 * đường nào để sửa/xoá dòng đã có — xem design.md của change
 * add-post-approval-supplement, Decision 1.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (found.status !== "approved") {
      return NextResponse.json(
        { error: "Chỉ bổ sung được dữ liệu bảng cho đề xuất đã duyệt." },
        { status: 400 },
      );
    }
    // Chỉ CHÍNH người làm đề xuất — Owner/Admin không được thao tác thay,
    // khác hẳn quy tắc "submitter hoặc Owner/Admin" ở các nơi khác của app
    // này (quyết định của Sếp, xem proposal.md). Dùng chung 1 hàm với route
    // attachments + UI (lib/permissions.ts) — đổi luật chỉ cần sửa 1 chỗ.
    if (!canSupplementAfterApproval(found, session.uid)) {
      throw new ForbiddenError("Chỉ chính người làm đề xuất mới bổ sung được dữ liệu bảng.");
    }

    const body = (await request.json()) as TableSupplementBody;
    const fieldId = body.fieldId;
    if (typeof fieldId !== "string" || !fieldId) {
      return NextResponse.json({ error: "Thiếu fieldId." }, { status: 400 });
    }
    const fieldIndex = found.fieldsSnapshot.findIndex((f) => f.id === fieldId);
    const field = fieldIndex >= 0 ? found.fieldsSnapshot[fieldIndex] : undefined;
    if (!field || (field.dataType !== "table" && field.dataType !== "base_table")) {
      return NextResponse.json(
        { error: "Field không hợp lệ hoặc không phải kiểu bảng." },
        { status: 400 },
      );
    }

    const rawNewRows = Array.isArray(body.newRows) ? body.newRows : [];
    const newRows: string[][] = rawNewRows
      .filter((r): r is unknown[] => Array.isArray(r))
      .map((r) => r.map((cell) => String(cell ?? "")));
    if (newRows.length === 0) {
      return NextResponse.json({ error: "Thiếu dữ liệu dòng cần bổ sung." }, { status: 400 });
    }

    // Cột mới — dedupe theo tên chuẩn hoá, đúng logic dùng ở
    // parseTableImportFile()/lib/table-field.ts, để 2 đường (soạn & bổ sung
    // sau duyệt) hiểu "cùng 1 cột" theo đúng 1 quy tắc.
    const existingColumns = field.tableColumns ?? [];
    const existingByNormalized = new Set(existingColumns.map((c) => normalizeColumnName(c)));
    const rawNewColumns = Array.isArray(body.newColumns)
      ? body.newColumns.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [];
    const seenNormalized = new Set<string>();
    const dedupedNewColumns = rawNewColumns.filter((c) => {
      const n = normalizeColumnName(c);
      if (existingByNormalized.has(n) || seenNormalized.has(n)) return false;
      seenNormalized.add(n);
      return true;
    });
    const finalColumns = [...existingColumns, ...dedupedNewColumns];

    // Dòng CŨ giữ nguyên nội dung — chỉ bù thêm ô trống cho (các) cột mới để
    // số cột khớp hàng, KHÔNG sửa giá trị nào đã có. Dòng MỚI nối vào cuối.
    const oldRows = deserializeTableRows(found.values[fieldId]);
    const paddedOldRows = oldRows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));
    const paddedNewRows = newRows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));

    const values: Record<string, unknown> = {
      ...found.values,
      [fieldId]: toWireTableRows([...paddedOldRows, ...paddedNewRows]),
    };
    // Cột mới CHỈ ghi vào snapshot của đề xuất này — KHÔNG đụng field config
    // sống của group (khác hành vi ở trang soạn), xem design.md Decision 3.
    const fieldsSnapshot = found.fieldsSnapshot.map((f, i) =>
      i === fieldIndex ? { ...f, tableColumns: finalColumns } : f,
    );

    const priorCount = found.history.filter((h) =>
      h.action.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX),
    ).length;
    const nowIso = new Date().toISOString();
    const historyEntry: RequestHistoryEntry = {
      at: nowIso,
      actor: session.name,
      action: `${TABLE_SUPPLEMENT_HISTORY_PREFIX} (lần ${priorCount + 1}): thêm ${newRows.length} dòng vào "${field.name}"`,
    };
    const history = [...found.history, historyEntry];

    // KHÔNG cập nhật `updatedAt` — giống hành vi route attachments khi đính
    // file, field này chỉ dành cho các mốc "sửa nháp/gửi/quyết định duyệt"
    // (xem comment tại RequestInstance.updatedAt, lib/types.ts) chứ không
    // phải mọi thao tác bổ sung nhỏ sau duyệt.
    const ref = adminDb.collection("requests").doc(id);
    await ref.update({ values, fieldsSnapshot, history });

    const updated: RequestInstance = { ...found, values, fieldsSnapshot, history };
    return NextResponse.json({ request: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
