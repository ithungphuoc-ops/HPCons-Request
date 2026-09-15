"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getIsoWeekInfo } from "@/lib/iso-week";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  Forward,
  History,
  Info,
  Link2,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  Star,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  Webhook,
  X,
  XCircle,
} from "lucide-react";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import ForwardModal, { type ForwardMode } from "@/components/request/ForwardModal";
import ReasonModal from "@/components/request/ReasonModal";
import ApproveConfirmModal from "@/components/request/ApproveConfirmModal";
import AddFollowerModal from "@/components/request/modals/AddFollowerModal";
import FilePreviewModal from "@/components/request/FilePreviewModal";
import CommentSection from "@/components/request/CommentSection";
import { canApproverAct } from "@/lib/approval-logic";
import { useCurrentSession } from "@/lib/useCurrentSession";
import { fieldDataTypeLabels } from "@/lib/types";
import { DEFAULT_GROUP_PERMISSION_RULES, DEFAULT_GROUP_PRINT_OPTIONS } from "@/lib/types";
import type {
  ApprovalTimeField,
  FieldDataType,
  GroupPermissionRules,
  GroupPrintOptions,
  PrintTemplate,
  ProposalField,
  RequestAttachment,
  RequestHistoryEntry,
  RequestInstance,
  TableColumnType,
  TaggedUser,
} from "@/lib/types";
import {
  deserializeTableRows,
  formatCellForDisplay,
  isNumericColumnType,
  numericTypeForFieldDataType,
  resolveTableColumnTypes,
  sumColumn,
} from "@/lib/table-field";
import { uploadAttachments } from "@/lib/upload-client";
import { canSupplementAfterApproval as canSupplementAfterApprovalCheck } from "@/lib/permissions";
import {
  ADJUSTMENT_HISTORY_PREFIX,
  ADJUSTMENT_MAX_LENGTH,
  ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX,
  TABLE_SUPPLEMENT_HISTORY_PREFIX,
} from "@/lib/request-history-labels";
import { resolveRequestTitle } from "@/lib/request-title";

/** Sinh 1 file CSV từ field/giá trị của ĐÚNG 1 đề xuất — "Xuất dữ liệu cho
 * bảng" trong menu "Thêm", thuần phía client, không gọi server (xem
 * design.md của change add-request-detail-base-parity, Decision #6). */
function exportRequestToCsv(request: RequestInstance): void {
  const header = ["Tên đề xuất", ...request.fieldsSnapshot.map((f) => f.name)];
  const row = [
    resolveRequestTitle(request),
    ...request.fieldsSnapshot.map((f) => formatValue(request.values[f.id])),
  ];
  const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [header.map(escapeCsv).join(","), row.map(escapeCsv).join(",")].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${resolveRequestTitle(request).slice(0, 60)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function editLinkFor(request: RequestInstance): string {
  return request.groupId
    ? `/request/groups/${request.groupId}/submit?draftId=${request.id}`
    : `/request/direct/new?draftId=${request.id}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/**
 * Giống `formatValue` nhưng BIẾT kiểu field: field ngày/ngày giờ lưu dạng ISO
 * ("2026-09-14") — hiện nguyên si ra màn hình thì lệch hẳn với ngày tạo/cập
 * nhật ở ngay phía trên (đang dd/MM/yyyy). Sếp yêu cầu thống nhất 13/09/2026.
 *
 * Cắt chuỗi bằng regex thay vì `new Date(...)` — chuỗi "YYYY-MM-DD" trần được
 * JS hiểu là mốc UTC, đổi qua giờ địa phương ở múi giờ âm sẽ LÙI 1 ngày.
 */
function formatFieldValue(value: unknown, dataType?: FieldDataType): string {
  // Trường số (Số nguyên / Số thập phân / Tiền tệ): dùng CHUNG bộ định dạng
  // với cột bảng, xem numericTypeForFieldDataType() ở lib/table-field.ts.
  const numericType = dataType ? numericTypeForFieldDataType(dataType) : null;
  if (numericType) {
    if (value === undefined || value === null || value === "") return "—";
    return formatCellForDisplay(String(value), numericType) || "—";
  }
  if (dataType === "date" || dataType === "datetime") {
    if (value === undefined || value === null || value === "") return "—";
    const matched = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(value).trim());
    if (matched) {
      const [, y, m, d, hh, mm] = matched;
      return hh ? `${d}/${m}/${y} ${hh}:${mm}` : `${d}/${m}/${y}`;
    }
  }
  return formatValue(value);
}

function isOverdue(request: RequestInstance): boolean {
  if (request.status !== "pending" || !request.deadlineAt) return false;
  return new Date(request.deadlineAt).getTime() < Date.now();
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function formatCountdown(deadlineAt: string, now: number): string {
  const diff = new Date(deadlineAt).getTime() - now;
  if (diff <= 0) return "Đã quá hạn";
  const totalSeconds = Math.floor(diff / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function RequestDetailView({
  request,
  currentUid,
  onActed,
}: {
  request: RequestInstance;
  currentUid: string | null;
  onActed: () => void;
}) {
  const router = useRouter();
  const { isAdmin, session } = useCurrentSession();
  // Xóa bình luận đã khóa (quá 10 phút) CHỈ dành cho Owner — thu hẹp hơn
  // "Admin/Owner" (isAdmin) dùng cho các hành động quản lý khác trên trang
  // này, xem design.md của change add-comment-mentions-realtime, Decision #7.
  const isOwner = session?.role === "owner";
  const [actingOn, setActingOn] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // `now` đổi mỗi giây (đếm ngược hạn) khiến component re-render liên tục —
  // memo hoá để không tính lại tuần ISO mỗi lần re-render dù submittedAt
  // không đổi.
  const submittedWeekInfo = useMemo(() => getIsoWeekInfo(request.submittedAt), [request.submittedAt]);
  const [duplicating, setDuplicating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [printTemplates, setPrintTemplates] = useState<PrintTemplate[]>([]);
  const [printOptions, setPrintOptions] = useState<GroupPrintOptions>(DEFAULT_GROUP_PRINT_OPTIONS);
  const [permissionRules, setPermissionRules] = useState<GroupPermissionRules>(DEFAULT_GROUP_PERMISSION_RULES);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  // "Mẫu form phê duyệt" — đọc LIVE từ nhóm (không snapshot), xem design.md
  // của change add-base-vn-approver-and-approval-form-parity, Decision #3.
  const [approvalTimeFields, setApprovalTimeFields] = useState<ApprovalTimeField[]>([]);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  // "Đánh dấu đề xuất" (bookmark) — THEO TỪNG NGƯỜI XEM, cập nhật tối ưu
  // (optimistic) trước khi có response, xem tasks.md 3.1 của change
  // add-request-detail-base-parity.
  const [bookmarked, setBookmarked] = useState(
    currentUid !== null && (request.bookmarkedByUids ?? []).includes(currentUid),
  );
  const [bookmarking, setBookmarking] = useState(false);
  const [printHideDiscussion, setPrintHideDiscussion] = useState(false);
  const [attachments, setAttachments] = useState<RequestAttachment[]>(request.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [previewingAttachment, setPreviewingAttachment] = useState<RequestAttachment | null>(null);
  const [followers, setFollowers] = useState<TaggedUser[]>(request.followers);
  const [addFollowerOpen, setAddFollowerOpen] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  // Nhật ký hoạt động — nhân bản state cục bộ giống `attachments` ở trên, chỉ
  // để tính nhãn "Đính kèm/Bổ sung sau duyệt · lần N" ngay lập tức mà không
  // cần chờ tải lại cả trang (xem khu vực "Bổ sung sau duyệt", change
  // add-post-approval-supplement).
  const [history, setHistory] = useState<RequestHistoryEntry[]>(request.history);

  useEffect(() => {
    setBookmarked(currentUid !== null && (request.bookmarkedByUids ?? []).includes(currentUid));
    setAttachments(request.attachments ?? []);
    setFollowers(request.followers);
    setHistory(request.history);
  }, [request.bookmarkedByUids, request.attachments, request.followers, request.history, currentUid]);

  useEffect(() => {
    const reset = () => setPrintHideDiscussion(false);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  // Đánh dấu "đã xem" đề xuất này — dùng để chuông thông báo biết còn thấy
  // "mới" hay không cho 3 loại vốn không có khái niệm đã đọc (được nhắc tên/
  // đang theo dõi/đã xử lý xong phần mình) — xem design.md của change
  // fix-notification-bell-stale-gaps. Bắn rồi quên, không cần chờ/hiện lỗi.
  useEffect(() => {
    fetch(`/api/requests/${request.id}/view`, { method: "POST" }).catch(() => {});
  }, [request.id]);

  const isOwnRequest = currentUid !== null && currentUid === request.submittedBy.uid;
  const canManage = isOwnRequest || isAdmin;
  // Dùng chung 1 hàm với 2 route table-supplement/attachments
  // (lib/permissions.ts) — đổi luật chỉ cần sửa 1 chỗ, xem design.md của
  // change add-post-approval-supplement.
  const canSupplementAfterApproval = currentUid !== null && canSupplementAfterApprovalCheck(request, currentUid);
  const attachmentSupplementEntries = history.filter((h) =>
    h.action.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX),
  );
  /** Các lần đã ghi điều chỉnh sau duyệt — đọc thẳng từ history, không giữ
   * state riêng nên tải lại trang vẫn đúng. */
  const adjustmentEntries = history.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX));

  useEffect(() => {
    if (!request.groupId) return;
    fetch(`/api/groups/${request.groupId}/print-templates`)
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then(
        (data: {
          templates: PrintTemplate[];
          printOptions?: GroupPrintOptions;
          permissionRules?: GroupPermissionRules;
        }) => {
          setPrintTemplates(data.templates ?? []);
          setPrintOptions({ ...DEFAULT_GROUP_PRINT_OPTIONS, ...data.printOptions });
          setPermissionRules({ ...DEFAULT_GROUP_PERMISSION_RULES, ...data.permissionRules });
        },
      )
      .catch(() => setPrintTemplates([]));
  }, [request.groupId]);

  useEffect(() => {
    if (!request.groupId) return;
    fetch(`/api/groups/${request.groupId}/approval-time-fields`)
      .then((res) => (res.ok ? res.json() : { fields: [] }))
      .then((data: { fields: ApprovalTimeField[] }) => setApprovalTimeFields(data.fields ?? []))
      .catch(() => setApprovalTimeFields([]));
  }, [request.groupId]);

  useEffect(() => {
    if (!printMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(event.target as Node)) {
        setPrintMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [printMenuOpen]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [moreMenuOpen]);

  const duplicateRequest = async () => {
    setMoreMenuOpen(false);
    setDuplicating(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/requests/${request.id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể nhân bản đề xuất.");
      }
      const data = (await res.json()) as { request: RequestInstance };
      router.push(editLinkFor(data.request));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setDuplicating(false);
    }
  };

  const deleteRequest = async () => {
    if (!window.confirm("Xóa đề xuất này? Có thể khôi phục lại sau qua admin.")) return;
    setMoreMenuOpen(false);
    setManaging(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/requests/${request.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xóa đề xuất.");
      }
      onActed();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setManaging(false);
    }
  };

  const restoreRequest = async () => {
    setManaging(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/requests/${request.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể khôi phục đề xuất.");
      }
      onActed();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setManaging(false);
    }
  };

  const toggleBookmark = async () => {
    if (!currentUid || bookmarking) return;
    setBookmarked((v) => !v); // optimistic
    setBookmarking(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/bookmark`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { bookmarkedByUids: string[] };
      setBookmarked(data.bookmarkedByUids.includes(currentUid));
      // PHẢI nạp lại danh sách: tab "Đã đánh dấu" (thêm 14/09/2026) lọc theo
      // `bookmarkedByUids` của mảng `requests` ở trang danh sách. Nếu chỉ đổi
      // state cục bộ thì bấm sao xong, bấm sang tab đó vẫn thấy trống và số
      // đếm vẫn 0 cho tới khi F5 — tính năng mới trông như hỏng ngay lần đầu.
      onActed();
    } catch {
      setBookmarked((v) => !v); // rollback
      setActionError("Không thể đánh dấu đề xuất — thử lại.");
    } finally {
      setBookmarking(false);
    }
  };

  const copyLink = async () => {
    setMoreMenuOpen(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setActionError(null);
    } catch {
      setActionError("Không thể sao chép đường dẫn.");
    }
  };

  const openInNewTab = () => {
    setMoreMenuOpen(false);
    window.open(window.location.href, "_blank");
  };

  const printRequest = (withDiscussion: boolean) => {
    setMoreMenuOpen(false);
    setPrintHideDiscussion(!withDiscussion);
    setTimeout(() => window.print(), 50);
  };

  const uploadAttachment = async (file: File) => {
    setUploadingAttachment(true);
    setActionError(null);
    try {
      // Tải thẳng lên R2 (không qua Vercel) — xem lib/upload-client.ts.
      const uploaded = await uploadAttachments([file]);
      const attachment = uploaded[0];
      if (!attachment) throw new Error("Không thể tải tệp lên.");

      const res = await fetch(`/api/requests/${request.id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachment }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể thêm tài liệu.");
      }
      const data = (await res.json()) as { attachments: RequestAttachment[]; history?: RequestHistoryEntry[] };
      setAttachments(data.attachments);
      if (data.history) setHistory(data.history);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const addFollower = async (user: TaggedUser) => {
    const res = await fetch(`/api/requests/${request.id}/followers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Không thể thêm người theo dõi.");
    }
    const data = (await res.json()) as { followers: TaggedUser[] };
    setFollowers(data.followers);
    setAddFollowerOpen(false);
  };

  useEffect(() => {
    if (request.status !== "pending" || !request.deadlineAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [request.status, request.deadlineAt]);

  const canAct =
    currentUid !== null && canApproverAct(request.approvalFlow, request.approvers, currentUid);

  // Mã bước của NGƯỜI ĐANG XEM (nếu họ là 1 trong các người duyệt) — dùng để
  // khớp "Mẫu form phê duyệt". `approverStepMeta` chỉ có ở đề xuất tạo sau
  // change này (đề xuất cũ hơn → luôn undefined → không field nào khớp, giữ
  // đúng hành vi cũ).
  const myApproverIndex = currentUid ? request.approvers.findIndex((a) => a.id === currentUid) : -1;
  const myApproverStepCode =
    myApproverIndex >= 0 ? request.approverStepMeta?.[myApproverIndex]?.code : undefined;

  const findApprovalTimeFieldRecord = (
    decisionAction: ApprovalTimeField["decisionAction"],
  ): ApprovalTimeField | undefined => {
    if (!myApproverStepCode) return undefined;
    return approvalTimeFields.find(
      (f) => f.approverStepCode === myApproverStepCode && f.decisionAction === decisionAction,
    );
  };

  const approveFieldRecord = findApprovalTimeFieldRecord("approve");
  const rejectFieldRecord = findApprovalTimeFieldRecord("reject");
  const approveField = approveFieldRecord?.field;
  const rejectField = rejectFieldRecord?.field;
  // Quy đổi 2 ForwardMode thật (approve_and_forward/forward_then_approve)
  // sang 2 decisionAction của "Mẫu form phê duyệt" (approveAndForward/forward)
  // — xem ghi chú ở ForwardModal.tsx.
  const forwardRecordByMode: Partial<Record<ForwardMode, ApprovalTimeField>> = {
    approve_and_forward: findApprovalTimeFieldRecord("approveAndForward"),
    forward_then_approve: findApprovalTimeFieldRecord("forward"),
  };
  const forwardFieldsByMode: Partial<Record<ForwardMode, ApprovalTimeField["field"]>> = {
    approve_and_forward: forwardRecordByMode.approve_and_forward?.field,
    forward_then_approve: forwardRecordByMode.forward_then_approve?.field,
  };

  const decide = async (
    decision: "approved" | "rejected" | "returned",
    note?: string,
    approvalTimeValue?: unknown,
    approvalTimeFieldId?: string,
  ) => {
    setActingOn(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/requests/${request.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note,
          approvalTimeFieldId,
          approvalTimeValue,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xử lý quyết định.");
      }
      setRejectOpen(false);
      setReturnOpen(false);
      setApproveConfirmOpen(false);
      onActed();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      throw err;
    } finally {
      setActingOn(false);
    }
  };

  const forward = async (mode: ForwardMode, target: TaggedUser, note: string, approvalTimeValue?: unknown) => {
    const matchedRecord = forwardRecordByMode[mode];
    const res = await fetch(`/api/requests/${request.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: mode,
        target,
        note,
        approvalTimeValue: matchedRecord ? approvalTimeValue : undefined,
        approvalTimeFieldId: matchedRecord?.id,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Không thể chuyển tiếp.");
    }
    setForwardOpen(false);
    onActed();
  };

  return (
    // Xếp DỌC mặc định, chỉ nằm cạnh nhau từ khổ xl (1280px — breakpoint máy
    // tính để bàn theo HPCons Design System V1.1).
    //
    // Trước 14/09/2026 đây là `flex gap-6` cứng, KHÔNG có một lớp responsive
    // nào trong cả tệp này. Hậu quả đo được ở khổ điện thoại 390px: vùng nội
    // dung còn 308px, cột phải ghim cứng 300px + khoảng cách 24px đã ăn hết,
    // nên `flex-[3] min-w-0` của nội dung chính bị ép xuống ĐÚNG 0px — mở một
    // đề xuất trên điện thoại gần như chỉ thấy cột "Người xét duyệt", không
    // đọc được nội dung phiếu, và khung còn tràn ngang.
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-[3]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-gray-900">{resolveRequestTitle(request)}</h1>
            <div className="mt-2 flex items-center gap-2">
              <RequestStatusBadge status={request.status} />
              {isOverdue(request) && (
                <span className="inline-flex h-6 items-center rounded-full bg-red-100 px-2.5 text-[12px] font-medium text-[var(--color-danger-red)]">
                  Quá hạn
                </span>
              )}
              {currentUid && (
                <button
                  type="button"
                  onClick={toggleBookmark}
                  disabled={bookmarking}
                  title="Đánh dấu đề xuất quan trọng"
                  aria-label="Đánh dấu đề xuất quan trọng"
                  aria-pressed={bookmarked}
                  className={`print-hide flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-gray-100 disabled:opacity-60 ${
                    bookmarked ? "text-amber-500" : "text-gray-300"
                  }`}
                >
                  <Star size={16} fill={bookmarked ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--color-border)] bg-gray-50 px-2.5 py-1 text-[12px] text-gray-400">
            Mã: <span className="font-mono font-bold text-gray-800">{request.code ?? request.id}</span>
          </span>
        </div>

        {request.deletedAt && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-100 bg-red-50 px-3 py-2 text-[14px] text-[var(--color-danger-red)]">
            <span>Đề xuất đã bị xóa lúc {new Date(request.deletedAt).toLocaleString("vi-VN")}.</span>
            {isAdmin && (
              <button
                type="button"
                onClick={restoreRequest}
                disabled={managing}
                className="flex shrink-0 items-center gap-1 rounded bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--color-danger-red)] ring-1 ring-inset ring-red-200 transition-colors hover:bg-red-100 disabled:opacity-60"
              >
                <RotateCcw size={13} /> Khôi phục
              </button>
            )}
          </div>
        )}

        <div className="print-hide mt-3 flex flex-wrap items-center gap-2">
          {request.status !== "draft" && printTemplates.length > 0 && printOptions.allowPrintToWord && (
            <div ref={printMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setPrintMenuOpen((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[12px] font-medium text-gray-600 transition-colors hover:border-[var(--color-action-blue)] hover:bg-gray-50"
              >
                <FileDown size={13} /> In theo mẫu <ChevronDown size={12} />
              </button>
              {printMenuOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-[260px] rounded border border-[var(--color-border)] bg-white shadow-lg">
                  {printTemplates.map((t) => (
                    <a
                      key={t.id}
                      href={`/api/requests/${request.id}/export?templateId=${t.id}`}
                      onClick={() => setPrintMenuOpen(false)}
                      className="flex items-center justify-between gap-2 border-b border-gray-50 px-3 py-2 text-[12px] text-gray-700 last:border-0 hover:bg-gray-50"
                    >
                      <span className="truncate">{t.name}</span>
                      {t.isDefault && (
                        <span className="shrink-0 text-[12px] text-yellow-600">Mặc định</span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {(request.status === "returned" || request.status === "pending") && isOwnRequest && (
            <a
              href={editLinkFor(request)}
              title={
                request.status === "pending"
                  ? "Sửa nội dung — mọi quyết định duyệt đã có sẽ bị xoá, duyệt lại từ đầu"
                  : undefined
              }
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-action-blue)] px-3 text-[12px] font-medium text-[var(--color-action-blue)] transition-colors hover:bg-blue-50"
            >
              <PenLine size={13} /> Sửa và gửi lại
            </a>
          )}
          {(currentUid || (canManage && !request.deletedAt)) && (
            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen((v) => !v)}
                disabled={duplicating || managing}
                className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[12px] font-medium text-gray-600 transition-colors hover:border-[var(--color-action-blue)] hover:bg-gray-50 disabled:opacity-60"
              >
                <MoreHorizontal size={13} /> Thêm
              </button>
              {moreMenuOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-[260px] overflow-hidden rounded border border-[var(--color-border)] bg-white py-1 shadow-lg">
                  <button type="button" onClick={copyLink} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50">
                    <Link2 size={13} /> Sao chép đường dẫn
                  </button>
                  <button type="button" onClick={openInNewTab} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50">
                    <ExternalLink size={13} /> Xem ở trong tab mới
                  </button>

                  <div className="my-1 border-t border-gray-100" />

                  {printOptions.allowPrintProposal && (
                    <button type="button" onClick={() => printRequest(false)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50">
                      <Printer size={13} /> In đề xuất
                    </button>
                  )}
                  {printOptions.allowPrintProposalWithDiscussion && (
                    <button type="button" onClick={() => printRequest(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50">
                      <Printer size={13} /> In đề xuất và thảo luận
                    </button>
                  )}
                  {printOptions.allowPrintToWord && printTemplates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setPrintMenuOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <FileDown size={13} /> In đề xuất theo mẫu ra file Word
                    </button>
                  )}
                  <button
                    type="button"
                    disabled
                    title="Chờ hạ tầng xuất PDF (add-pdf-export)"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-400 cursor-not-allowed"
                  >
                    <FileDown size={13} /> In đề xuất theo mẫu ra file PDF
                    <span className="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">⏳</span>
                  </button>

                  <div className="my-1 border-t border-gray-100" />

                  {currentUid && (
                    <button type="button" onClick={() => { setMoreMenuOpen(false); toggleBookmark(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50">
                      <Star size={13} /> Đánh dấu đề xuất
                    </button>
                  )}
                  <button
                    type="button"
                    disabled
                    title="Chưa có hạ tầng webhook cho từng đề xuất"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-400 cursor-not-allowed"
                  >
                    <Webhook size={13} /> Lịch sử webhook
                    <span className="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">⏳</span>
                  </button>

                  <div className="my-1 border-t border-gray-100" />

                  {currentUid && (
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); setAddFollowerOpen(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <UserPlus size={13} /> Thêm nhiều người theo dõi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); exportRequestToCsv(request); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Download size={13} /> Xuất dữ liệu cho bảng
                  </button>

                  <div className="my-1 border-t border-gray-100" />

                  {currentUid && (
                    <button
                      type="button"
                      onClick={duplicateRequest}
                      disabled={duplicating}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                    >
                      <Copy size={13} /> {duplicating ? "Đang nhân bản..." : "Nhân bản"}
                    </button>
                  )}
                  {canManage && !request.deletedAt && (
                    <button
                      type="button"
                      onClick={deleteRequest}
                      disabled={managing}
                      className="flex w-full items-center gap-2 border-t border-gray-50 px-3 py-2 text-left text-[12px] text-gray-600 transition-colors hover:bg-red-50 hover:text-[var(--color-danger-red)] disabled:opacity-60"
                    >
                      <Trash2 size={13} /> Xóa
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {canAct && (
          <div className="print-hide mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                approveField ? setApproveConfirmOpen(true) : decide("approved").catch(() => {})
              }
              disabled={actingOn}
              className="flex h-9 items-center gap-1.5 rounded bg-[var(--color-confirm-green)] px-4 text-[14px] font-medium text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
            >
              <Check size={15} /> Chấp thuận
            </button>
            <button
              type="button"
              onClick={() => setForwardOpen(true)}
              disabled={actingOn}
              className="flex h-9 items-center gap-1.5 rounded bg-teal-500 px-4 text-[14px] font-medium text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
            >
              <Forward size={15} /> Chuyển tiếp
            </button>
            <button
              type="button"
              onClick={() => setReturnOpen(true)}
              disabled={actingOn}
              className="flex h-9 items-center gap-1.5 rounded bg-orange-500 px-4 text-[14px] font-medium text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
            >
              <Undo2 size={15} /> Trả lại
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              disabled={actingOn}
              className="flex h-9 items-center gap-1.5 rounded bg-[var(--color-danger-red)] px-4 text-[14px] font-medium text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
            >
              <X size={15} /> Từ chối
            </button>
          </div>
        )}
        {actionError && (
          <p className="mt-2 text-[14px] text-[var(--color-danger-red)]">{actionError}</p>
        )}

        <div className="mt-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-wide text-gray-500">
            <Info size={14} /> Thông tin đề xuất
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            <div>
              <dt className="text-gray-400">Người tạo</dt>
              <dd className="font-medium text-gray-800">{request.submittedBy.name}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Nhóm đề xuất</dt>
              <dd className="font-medium text-[var(--color-action-blue)]">
                {request.groupNameSnapshot}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Thời gian tạo</dt>
              <dd className="font-medium text-gray-800">
                {new Date(request.submittedAt).toLocaleString("vi-VN")}
                <span className="ml-1.5 text-gray-400">
                  (Tuần {submittedWeekInfo.week} - {submittedWeekInfo.isOdd ? "lẻ" : "chẵn"})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Cập nhật gần nhất</dt>
              <dd className="font-medium text-gray-800">
                {formatRelativeTime(request.updatedAt ?? request.submittedAt)}
              </dd>
            </div>
            {request.deadlineAt && (
              <>
                <div>
                  <dt className="text-gray-400">Thời hạn của đề xuất</dt>
                  <dd className="font-medium text-gray-800">
                    {new Date(request.deadlineAt).toLocaleString("vi-VN")}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Thời gian còn lại</dt>
                  <dd
                    className={`flex items-center gap-1.5 font-medium tabular-nums ${
                      isOverdue(request)
                        ? "text-[var(--color-danger-red)]"
                        : request.status === "pending" &&
                            new Date(request.deadlineAt).getTime() - now < 2 * 60 * 60 * 1000
                          ? "text-orange-500"
                          : "text-gray-800"
                    }`}
                  >
                    {request.status === "pending" && (
                      <Clock size={13} className="shrink-0" />
                    )}
                    {request.status === "pending"
                      ? formatCountdown(request.deadlineAt, now)
                      : "—"}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>

        {request.fieldsSnapshot.length > 0 && (
          <div className="mt-4 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-wide text-gray-500">
              <ListChecks size={14} /> Thông tin khác (mẫu đăng ký đề xuất)
            </h2>
            <dl className="flex flex-col gap-3 text-[14px]">
              {request.fieldsSnapshot
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((field, index) => {
                  const isTable = field.dataType === "table" || field.dataType === "base_table";
                  const isFile = field.dataType === "file";
                  const isUser = field.dataType === "user_select";
                  return (
                    <div key={field.id}>
                      <dt className="text-gray-400">
                        {String(index + 1).padStart(2, "0")}. {field.name}
                        <span className="ml-2 text-[12px] text-gray-300">
                          {fieldDataTypeLabels[field.dataType]}
                        </span>
                      </dt>
                      {isTable ? (
                        <TableValueView
                          columns={field.tableColumns ?? []}
                          columnTypes={field.tableColumnTypes}
                          rows={deserializeTableRows(request.values[field.id])}
                        />
                      ) : isFile ? (
                        <FileValueView
                          requestId={request.id}
                          attachments={(request.values[field.id] as RequestAttachment[]) ?? []}
                        />
                      ) : isUser ? (
                        <UserValueView user={request.values[field.id] as TaggedUser | null} />
                      ) : (
                        <dd className="font-medium text-gray-800">
                          {formatFieldValue(request.values[field.id], field.dataType)}
                        </dd>
                      )}
                    </div>
                  );
                })}
            </dl>
          </div>
        )}

        {request.approvalTimeValues && Object.keys(request.approvalTimeValues).length > 0 && (
          <div className="mt-4 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-wide text-gray-500">
              <ListChecks size={14} /> Thông tin phê duyệt
            </h2>
            <dl className="flex flex-col gap-3 text-[14px]">
              {Object.entries(request.approvalTimeValues).map(([fieldId, value]) => {
                const atf = approvalTimeFields.find((f) => f.id === fieldId);
                return (
                  <div key={fieldId}>
                    <dt className="text-gray-400">
                      {atf?.field.name ?? "Trường đã xoá"}
                      {atf && (
                        <span className="ml-2 text-[12px] text-gray-300">
                          {fieldDataTypeLabels[atf.field.dataType]}
                        </span>
                      )}
                    </dt>
                    <dd className="font-medium text-gray-800">{formatValue(value)}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {/* Chỉ hiện khi đề xuất ĐÃ CHẤP THUẬN hoàn toàn — trước đó ẩn hẳn,
            không còn cách đính tài liệu chung/nối dòng bảng nào khác (yêu
            cầu Sếp 12/09/2026, đã duyệt qua demo). Gộp 2 việc trước đây tách
            rời: nối dòng vào field kiểu bảng (trước ở link riêng dưới mỗi
            bảng, xem TableSupplementControl) + đính tài liệu cấp đề xuất. */}
        {request.status === "approved" && (
          <div className="mt-4 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-wide text-gray-500">
              <Paperclip size={14} /> Điều chỉnh đề nghị sau duyệt
            </h2>
            {/* Câu này là phần QUAN TRỌNG của thay đổi 15/09/2026, không phải
                chữ trang trí: khối cũ là một bảng trống đủ 5 cột nhìn y hệt
                bảng lúc tạo đề xuất, nên người dùng hiểu nhầm đây là chỗ khai
                THÊM MẶT HÀNG MỚI. Nói thẳng dùng khi nào là hết hiểu nhầm. */}
            <p className="mb-3 rounded-r border-l-[3px] border-[var(--color-action-blue)] bg-gray-50 px-3 py-2 text-[14px] leading-relaxed text-gray-600">
              Dùng khi phiếu đã duyệt nhưng cần sửa đổi số lượng hoặc quy cách hàng đã đề xuất. Không
              áp dụng cho việc đề nghị hàng khác.
            </p>

            {/* Các dòng ĐÃ bổ sung bằng khối bảng cũ (trước 15/09/2026) vẫn
                hiện nguyên — chỉ bỏ chỗ NHẬP mới, không bỏ dữ liệu đã có. */}
            {request.fieldsSnapshot
              .filter((field) => field.dataType === "table" || field.dataType === "base_table")
              .map((field) => (
                <TableSupplementControl
                  key={field.id}
                  field={field}
                  rows={deserializeTableRows(request.values[field.id])}
                  history={history}
                />
              ))}

            {canSupplementAfterApproval && (
              <AdjustmentControl
                requestId={request.id}
                onDone={(data) => {
                  setAttachments(data.attachments);
                  setHistory(data.history);
                }}
              />
            )}

            {adjustmentEntries.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
                {adjustmentEntries.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="text-[14px] text-gray-700">
                    <span className="text-gray-800">{h.note}</span>
                    <span className="ml-1.5 text-[12px] text-amber-600">
                      🕘 {h.actor} · {new Date(h.at).toLocaleString("vi-VN")} · lần {i + 1}
                    </span>
                    {/* Tệp đi kèm ĐÚNG lần điều chỉnh này (Sếp chốt "cách 1",
                        15/09/2026) — tệp vẫn nằm trong danh sách "Tài liệu đính
                        kèm" bên dưới, đây chỉ là chỗ cho biết nó thuộc lần nào. */}
                    {h.attachmentName && (
                      <span className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--color-action-blue)]">
                        <Paperclip size={11} className="shrink-0" />
                        {h.attachmentName}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <p className="text-[12px] font-medium text-gray-600">Tài liệu đính kèm</p>
              {isOwnRequest && (
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={uploadingAttachment}
                  className="print-hide flex items-center gap-1 text-[12px] font-medium text-[var(--color-action-blue)] hover:underline disabled:opacity-60"
                >
                  <Plus size={13} /> {uploadingAttachment ? "Đang tải lên..." : "Thêm tệp tin"}
                </button>
              )}
              <input
                ref={attachmentInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAttachment(file);
                }}
              />
            </div>
            {attachments.length === 0 ? (
              <p className="mt-1.5 text-[14px] text-gray-400">Chưa có tài liệu nào.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1">
                {attachments.map((att, i) => {
                  // `attachments[]` chỉ NỐI THÊM (không chèn giữa/xoá), và
                  // trạng thái "approved" không quay lại trạng thái khác — nên
                  // K mục cuối cùng luôn ĐÚNG là K lần đính "sau duyệt" đã ghi
                  // trong history, cùng thứ tự. Xem design.md của change
                  // add-post-approval-supplement, Decision 5.
                  const firstPostApprovalIndex = attachments.length - attachmentSupplementEntries.length;
                  const supplementEntry =
                    i >= firstPostApprovalIndex ? attachmentSupplementEntries[i - firstPostApprovalIndex] : null;
                  return (
                    <li key={att.path}>
                      <button
                        type="button"
                        onClick={() => setPreviewingAttachment(att)}
                        className="flex w-full items-center gap-1.5 text-left text-[14px] text-[var(--color-action-blue)] hover:underline"
                      >
                        <Paperclip size={13} className="shrink-0" />
                        <span className="truncate">{att.name}</span>
                        <span className="shrink-0 text-gray-400">({(att.size / 1024 / 1024).toFixed(1)}MB)</span>
                      </button>
                      {supplementEntry && (
                        <p className="ml-[19px] text-[10.5px] font-medium text-amber-600">
                          🕘 Đính sau duyệt · lần {i - firstPostApprovalIndex + 1} ·{" "}
                          {new Date(supplementEntry.at).toLocaleString("vi-VN")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {previewingAttachment && (
              <FilePreviewModal
                requestId={request.id}
                attachment={previewingAttachment}
                onClose={() => setPreviewingAttachment(null)}
              />
            )}
          </div>
        )}

        <div className={`mt-4 rounded-[3px] border border-[var(--color-border)] bg-white p-4 ${printHideDiscussion ? "print-hide" : ""}`}>
          <h2 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-wide text-gray-500">
            <MessageSquare size={14} /> Thảo luận
          </h2>
          <CommentSection
            requestId={request.id}
            initialComments={request.comments ?? []}
            currentUid={currentUid}
            isOwner={isOwner}
          />
        </div>
      </div>

      {/* Xếp dọc (dưới xl): rộng hết khổ. Nằm cạnh (từ xl): giữ đúng 300px
          như cũ, không co lại. */}
      <div className="print-hide flex w-full flex-col gap-4 xl:w-[300px] xl:shrink-0">
        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            <Users size={13} /> Người xét duyệt
          </h3>
          <div className="flex flex-col gap-2">
            {request.approversSnapshot.map((approver, index) => {
              const state = request.approvers.find((a) => a.id === approver.id);
              const stepMeta = request.approverStepMeta?.[index];
              // Ai ĐANG tới lượt — trước đây mọi người còn "pending" đều hiện
              // chung một chữ "Chưa xử lý", nhìn vào không biết đề xuất đang
              // tắc ở ai. Dùng lại canApproverAct (đúng hàm quyết định quyền
              // thao tác), nên nhãn hiển thị không thể lệch với thực tế.
              const isCurrentTurn =
                request.status === "pending" &&
                canApproverAct(request.approvalFlow, request.approvers, approver.id);
              // `deadlineAt` là hạn xử lý HIỆN HÀNH của đề xuất. Nó chỉ thật
              // sự là "hạn của riêng bước này" khi nhóm bật `approverSlaEnabled`
              // VÀ luồng là "Lần lượt" — chỉ khi đó server mới tính lại mỗi lần
              // chuyển bước (xem điều kiện đầu recomputeDeadlineForNextStep,
              // lib/server/requests.ts). Ngoài 2 điều kiện đó, nó vẫn là hạn
              // chung tính từ lúc gửi. Vì đề xuất chỉ có đúng MỘT người đang
              // tới lượt, gắn đồng hồ vào người đó vẫn đúng trong cả hai
              // trường hợp — nhưng nhãn KHÔNG được nói "bước này".
              const showCountdown = isCurrentTurn && !!request.deadlineAt;
              // Dùng `<=` cho khớp `formatCountdown` (trả "Đã quá hạn" khi
              // diff <= 0). Nếu để `<` thì đúng giây tròn hạn sẽ hiện ra chuỗi
              // vô nghĩa "Còn Đã quá hạn".
              const lateForThisStep =
                showCountdown && new Date(request.deadlineAt!).getTime() <= now;
              const StatusIcon =
                state?.decision === "approved"
                  ? CheckCircle2
                  : state?.decision === "rejected"
                    ? XCircle
                    : Clock;
              return (
                <div
                  key={approver.id}
                  className={`flex items-center gap-2 rounded text-[14px] ${
                    isCurrentTurn ? "-mx-1.5 bg-blue-50/70 px-1.5 py-1" : ""
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[12px] font-semibold text-white">
                    {approver.avatarInitial}
                  </span>
                  <span className="min-w-0 flex-1 text-gray-700">
                    <span className="block truncate">{approver.name}</span>
                    {(stepMeta?.name || stepMeta?.slaHours) && (
                      <span className="block truncate text-[12px] text-gray-400">
                        {stepMeta?.name}
                        {stepMeta?.name && stepMeta?.slaHours ? " · " : ""}
                        {stepMeta?.slaHours ? `Hạn xử lý: ${stepMeta.slaHours} giờ` : ""}
                      </span>
                    )}
                    {showCountdown && (
                      <span
                        className={`block truncate text-[12px] font-semibold ${
                          lateForThisStep
                            ? "text-[var(--color-danger-red)]"
                            : "text-[var(--color-action-blue)]"
                        }`}
                      >
                        {lateForThisStep
                          ? "Đã quá hạn"
                          : `Còn ${formatCountdown(request.deadlineAt!, now)}`}
                      </span>
                    )}
                  </span>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-[12px] ${
                      state?.decision === "approved"
                        ? "text-[var(--color-confirm-green)]"
                        : state?.decision === "rejected"
                          ? "text-[var(--color-danger-red)]"
                          : "text-gray-400"
                    }`}
                  >
                    <StatusIcon size={12} className="shrink-0" />
                    {state?.decision === "approved"
                      ? "Đã duyệt"
                      : state?.decision === "rejected"
                        ? "Đã từ chối"
                        : isCurrentTurn
                        ? "Đang chờ"
                        : request.status === "pending"
                          ? "Chưa tới lượt"
                          // Đề xuất đã kết thúc (luồng "Một người duyệt" chỉ
                          // cần 1 người đồng ý; hoặc bị từ chối giữa chừng ở
                          // luồng "Lần lượt") thì những người còn lại KHÔNG
                          // phải "chưa tới lượt" — sẽ không bao giờ tới lượt
                          // họ nữa. Giữ chữ trung tính như trước.
                          : "Chưa xử lý"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            <Eye size={13} /> Người theo dõi
          </h3>
          <div className="flex items-center">
            {followers.length === 0 && <span className="text-[12px] text-gray-400">Chưa có người theo dõi.</span>}
            {followers.map((f, i) => (
              <span
                key={f.id}
                title={f.name}
                style={{ marginLeft: i === 0 ? 0 : -9 }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white bg-gray-400 text-[12px] font-semibold text-white"
              >
                {f.avatarInitial}
              </span>
            ))}
            {currentUid && (
              <button
                type="button"
                onClick={() => setAddFollowerOpen(true)}
                title="Thêm người theo dõi"
                aria-label="Thêm người theo dõi"
                style={{ marginLeft: followers.length === 0 ? 0 : -9 }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-gray-500 hover:bg-gray-200"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            <Pin size={13} /> Hành động chính
          </h3>
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-md bg-gray-50 px-2 py-1 text-center">
              <div className="text-[12px] font-bold text-gray-600">
                {new Date(request.submittedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "short" }).toUpperCase()}
              </div>
              <div className="text-[12px] text-gray-400">
                {new Date(request.submittedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div className="mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[12px] font-bold text-white">
              +
            </div>
            <div className="text-[14px]">
              <p className="font-semibold text-gray-800">Request created</p>
              <p className="mt-0.5 text-gray-600">
                <span className="font-medium text-[var(--color-action-blue)]">{request.submittedBy.name}</span> đã tạo đề xuất này
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            <History size={13} /> Lịch sử hoạt động
          </h3>
          <div className="relative flex flex-col gap-4 border-l border-gray-200 pl-4">
            {request.history
              .slice()
              .reverse()
              .map((entry, index) => (
                <div key={index} className="relative text-[12px]">
                  <span
                    className={`absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ring-1 ring-[var(--color-border)] ${
                      index === 0 ? "bg-[var(--color-action-blue)]" : "bg-gray-300"
                    }`}
                  />
                  <p className="text-gray-700">
                    <span className="font-medium">{entry.actor}</span> {entry.action}
                    {entry.target && <> → {entry.target}</>}
                  </p>
                  {entry.note && (
                    <p className="mt-0.5 italic text-gray-400">&quot;{entry.note}&quot;</p>
                  )}
                  <p className="mt-0.5 text-[12px] text-gray-400">
                    {new Date(entry.at).toLocaleString("vi-VN")}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

      {forwardOpen && (
        <ForwardModal
          extraFieldByMode={forwardFieldsByMode}
          allowForwardThenApprove={permissionRules.approversCanDelegateApproval}
          onClose={() => setForwardOpen(false)}
          onConfirm={forward}
        />
      )}
      {rejectOpen && (
        <ReasonModal
          title="Từ chối đề xuất"
          confirmLabel="Từ chối"
          extraField={rejectField}
          onClose={() => setRejectOpen(false)}
          onConfirm={(note, approvalTimeValue) =>
            decide("rejected", note, approvalTimeValue, rejectFieldRecord?.id)
          }
        />
      )}
      {returnOpen && (
        <ReasonModal
          title="Trả lại đề xuất"
          confirmLabel="Trả lại"
          onClose={() => setReturnOpen(false)}
          onConfirm={(note) => decide("returned", note)}
        />
      )}
      {approveConfirmOpen && approveField && (
        <ApproveConfirmModal
          field={approveField}
          onClose={() => setApproveConfirmOpen(false)}
          onConfirm={(approvalTimeValue) => decide("approved", undefined, approvalTimeValue, approveFieldRecord?.id)}
        />
      )}
      {addFollowerOpen && (
        <AddFollowerModal onClose={() => setAddFollowerOpen(false)} onConfirm={addFollower} />
      )}
      {/* "In đề xuất"/"In đề xuất và thảo luận" (menu Thêm) — window.print()
          thuần, khác hẳn "In theo mẫu" (sinh file .docx thật). `.print-hide`
          áp cho sidebar/nút bấm; card Thảo luận thêm class này CÓ ĐIỀU KIỆN
          qua `printHideDiscussion` khi in KHÔNG kèm thảo luận. */}
      <style jsx global>{`
        @media print {
          .print-hide {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function UserValueView({ user }: { user: TaggedUser | null }) {
  if (!user) return <p className="font-medium text-gray-800">—</p>;
  return (
    <span className="mt-1 flex items-center gap-1.5 text-[14px] text-gray-800">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[12px] font-semibold text-white">
        {user.avatarInitial}
      </span>
      {user.name}
    </span>
  );
}

function FileValueView({
  requestId,
  attachments,
}: {
  requestId: string;
  attachments: RequestAttachment[];
}) {
  // Bấm vào file → mở popup xem trước trước khi tải về (yêu cầu Sếp 2026-08-19), thay vì
  // href target="_blank" tải/mở thẳng như trước.
  const [previewing, setPreviewing] = useState<RequestAttachment | null>(null);

  if (attachments.length === 0) {
    return <p className="text-[14px] text-gray-400">Chưa có tệp nào</p>;
  }
  return (
    <>
      <ul className="mt-1 flex flex-col gap-1">
        {attachments.map((att) => (
          <li key={att.path}>
            <button
              type="button"
              onClick={() => setPreviewing(att)}
              className="flex w-full items-center gap-1.5 text-left text-[14px] text-[var(--color-action-blue)] hover:underline"
            >
              <Paperclip size={13} className="shrink-0" />
              <span className="truncate">{att.name}</span>
              <span className="shrink-0 text-gray-400">({(att.size / 1024 / 1024).toFixed(1)}MB)</span>
            </button>
          </li>
        ))}
      </ul>
      {previewing && (
        <FilePreviewModal requestId={requestId} attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

/**
 * Khu vực "Bổ sung sau duyệt" cho field kiểu bảng — CHỈ hiện khi đề xuất đã
 * duyệt và người xem chính là submitter (điều kiện gọi ở nơi dùng, xem
 * `canSupplementAfterApproval`). Gõ trực tiếp từng dòng ngay trên trình
 * duyệt (đổi từ luồng tải/điền/nạp Excel trước đó, theo yêu cầu Sếp
 * 12/09/2026 — đã duyệt qua demo tương tác), nối thêm dòng qua route riêng
 * `POST /api/requests/[id]/table-supplement` — KHÔNG sửa/xoá dòng cũ, xem
 * design.md của change add-post-approval-supplement.
 */
/**
 * CHỈ HIỂN THỊ những dòng đã bổ sung bằng khối bảng CŨ (trước 15/09/2026).
 *
 * 🔴 Trước đây component này vừa hiện vừa CHO NHẬP thêm dòng. Sếp bỏ phần nhập
 * ngày 15/09/2026 vì bảng trống đủ 5 cột trông y hệt bảng lúc tạo đề xuất,
 * người dùng tưởng là chỗ khai thêm mặt hàng mới. Nay chỗ nhập là một ô chữ
 * ngắn (AdjustmentControl) ghi thẳng vào lịch sử.
 *
 * GIỮ phần hiển thị: đề xuất cũ đã bổ sung dòng thì dữ liệu đó vẫn nằm trong
 * `values` và vẫn phải đọc được. Đề xuất chưa từng bổ sung dòng nào thì
 * component trả `null`, không vẽ bảng rỗng.
 *
 * Route `POST /api/requests/[id]/table-supplement` VẪN CÒN và vẫn kiểm quyền
 * như cũ — chỉ không còn nút nào trong giao diện gọi tới nó.
 */
function TableSupplementControl({
  field,
  rows: allRows,
  history,
}: {
  field: ProposalField;
  /** Toàn bộ dòng HIỆN CÓ của field (đã bao gồm mọi lần bổ sung trước) —
   * `deserializeTableRows(request.values[field.id])` truyền từ nơi gọi. */
  rows: string[][];
  history: RequestHistoryEntry[];
}) {
  const columns = field.tableColumns ?? [];
  const emptyRow = () => columns.map(() => "");

  if (columns.length === 0) return null;

  // Suy ra các dòng ĐÃ bổ sung sau duyệt (khoá lại, hiện phía trên ô đang
  // gõ) + giờ của từng lần, hoàn toàn từ dữ liệu server — không lưu state
  // cục bộ riêng nên tải lại trang vẫn đúng. Bổ sung CHỈ NỐI VÀO CUỐI (không
  // chèn/sửa/xoá dòng cũ, xem route table-supplement), nên đếm tổng số dòng
  // đã bổ sung qua `history` rồi cắt đúng số đó ở cuối bảng hiện tại là khớp
  // đúng thứ tự.
  const batchRe = /\(lần \d+\): thêm (\d+) dòng vào "(.+)"$/;
  const batches: { count: number; at: string }[] = [];
  for (const h of history) {
    if (!h.action.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX)) continue;
    const m = h.action.match(batchRe);
    if (!m || m[2] !== field.name) continue;
    const count = Number(m[1]);
    if (Number.isFinite(count) && count > 0) batches.push({ count, at: h.at });
  }
  const totalSupplementRows = batches.reduce((sum, b) => sum + b.count, 0);
  const splitIndex = Math.max(0, allRows.length - totalSupplementRows);
  const supplementTailRows = allRows.slice(splitIndex);
  const loggedRows: { row: string[]; at: string }[] = [];
  let cursor = 0;
  for (const b of batches) {
    for (let i = 0; i < b.count; i++) {
      loggedRows.push({ row: supplementTailRows[cursor] ?? emptyRow(), at: b.at });
      cursor++;
    }
  }

  // Chưa từng bổ sung dòng nào (đề xuất mới, hoặc nhóm không dùng bảng) →
  // không vẽ gì. Trước đây luôn vẽ vì còn phải chứa ô nhập.
  if (loggedRows.length === 0) return null;

  return (
    <div className="mb-3 border-b border-[var(--color-border)] pb-3">
      <p className="mb-1.5 text-[12px] font-medium text-gray-600">
        {field.name} <span className="font-normal text-gray-400">— đã bổ sung trước đây</span>
      </p>
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left text-gray-400">#</th>
              {columns.map((col, i) => (
                <th key={i} className="px-2 py-1.5 text-left font-medium text-gray-600">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loggedRows.map((entry, li) => (
              <tr key={`logged-${li}`} className="border-t border-[var(--color-border)] bg-gray-50">
                <td className="px-2 py-1 text-gray-400">{li + 1}</td>
                {entry.row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1.5 align-top text-gray-700">
                    {ci === entry.row.length - 1 ? (
                      <>
                        <div>{cell || "—"}</div>
                        <div className="text-[12px] font-medium text-amber-600">
                          🕘 Cập nhật lúc {new Date(entry.at).toLocaleString("vi-VN")}
                        </div>
                      </>
                    ) : (
                      cell || "—"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ô ghi điều chỉnh sau duyệt — Sếp chốt 15/09/2026 thay cho khối bảng cũ.
 *
 * Gửi đi KHÔNG sửa `values`: bảng gốc là thứ người duyệt đã đọc và đã đồng ý,
 * ghi đè vào đó là mất dấu "duyệt cái gì / cuối cùng lấy cái gì". Nội dung đi
 * vào `history` kèm tên người và giờ (xem route adjustment).
 */
function AdjustmentControl({
  requestId,
  onDone,
}: {
  requestId: string;
  onDone: (data: { attachments: RequestAttachment[]; history: RequestHistoryEntry[] }) => void;
}) {
  const [noiDung, setNoiDung] = useState("");
  const [tep, setTep] = useState<File | null>(null);
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const oTepRef = useRef<HTMLInputElement>(null);

  const gui = async () => {
    const text = noiDung.trim();
    if (!text && !tep) {
      setLoi("Nhập nội dung điều chỉnh hoặc đính kèm tệp.");
      return;
    }
    setDangGui(true);
    setLoi(null);
    try {
      // Tệp lên R2 TRƯỚC, rồi mới gọi route — cùng luồng với nút "Thêm tệp
      // tin" bên dưới (xem uploadAttachment ở component cha).
      let attachment: RequestAttachment | undefined;
      if (tep) {
        const uploaded = await uploadAttachments([tep]);
        attachment = uploaded[0];
        if (!attachment) throw new Error("Không tải được tệp lên.");
      }
      const res = await fetch(`/api/requests/${requestId}/adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noiDung: text, ...(attachment ? { attachment } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoi(body.error ?? "Không gửi được điều chỉnh.");
        return;
      }
      const data = (await res.json()) as { request: RequestInstance };
      setNoiDung("");
      setTep(null);
      if (oTepRef.current) oTepRef.current.value = "";
      onDone({
        attachments: data.request.attachments ?? [],
        history: data.request.history,
      });
    } catch (err) {
      setLoi(err instanceof Error ? err.message : "Có lỗi xảy ra, vui lòng thử lại.");
    } finally {
      setDangGui(false);
    }
  };

  return (
    <div className="print-hide">
      {/* Bố cục Sếp chốt 15/09/2026: giống hệt ô Thảo luận — kẹp tệp bên trái,
          ô chữ NHIỀU DÒNG ở giữa, nút CÓ CHỮ bên phải.
          Vì sao không dùng nút mũi tên như Thảo luận: mũi tên hợp với ô chat
          (ai cũng hiểu là "gửi"), còn đây là hành động ghi vào hồ sơ nên phải
          nói thẳng đang làm gì.
          Vì sao bỏ nhãn "Nội dung điều chỉnh": câu hướng dẫn ngay phía trên đã
          nói rõ rồi, thêm nhãn nữa là ba dòng chữ chồng nhau. */}
      <div className="flex items-start gap-2">
        <input
          ref={oTepRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setTep(f);
          }}
        />
        <button
          type="button"
          onClick={() => oTepRef.current?.click()}
          disabled={dangGui}
          title="Đính kèm tệp cho lần điều chỉnh này"
          aria-label="Đính kèm tệp cho lần điều chỉnh này"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-border)] text-gray-500 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:opacity-50"
        >
          <Paperclip size={15} />
        </button>
        <textarea
          value={noiDung}
          maxLength={ADJUSTMENT_MAX_LENGTH}
          onChange={(e) => setNoiDung(e.target.value)}
          rows={2}
          placeholder="Mô tả điều chỉnh — ví dụ: Thép hộp 40x80 đổi từ 120 cây xuống 90 cây"
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-[14px] text-gray-800 outline-none focus:border-[var(--color-action-blue)]"
        />
        <button
          type="button"
          onClick={gui}
          disabled={dangGui}
          className="flex h-9 shrink-0 items-center rounded bg-[var(--color-action-blue)] px-4 text-[14px] font-medium text-white hover:brightness-95 disabled:opacity-50"
        >
          {dangGui ? "Đang gửi..." : "Cập nhật điều chỉnh"}
        </button>
      </div>
      {tep && (
        <span className="mt-2 inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-blue-50 px-2 py-1 text-[12px] text-gray-700">
          <Paperclip size={12} className="shrink-0" />
          {tep.name}
          <button
            type="button"
            onClick={() => {
              setTep(null);
              if (oTepRef.current) oTepRef.current.value = "";
            }}
            aria-label="Bỏ tệp đã chọn"
            className="text-gray-400 hover:text-[var(--color-danger-red)]"
          >
            <X size={12} />
          </button>
        </span>
      )}
      {loi && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{loi}</p>}
    </div>
  );
}

function TableValueView({
  columns,
  columnTypes,
  rows,
}: {
  columns: string[];
  columnTypes?: TableColumnType[];
  rows: string[][];
}) {
  if (columns.length === 0) {
    return <p className="font-medium text-gray-800">—</p>;
  }
  const filledRows = rows.filter((row) => row.some((cell) => cell?.trim()));
  if (filledRows.length === 0) {
    return <p className="font-medium text-gray-800">—</p>;
  }
  // Ô lưu số thô, chỉ chấm phẩy lúc hiện ra — xem lib/table-field.ts.
  const types = resolveTableColumnTypes(columns, columnTypes);
  const hasMoneyColumn = types.includes("money");

  return (
    <div className="mt-1 overflow-x-auto rounded border border-[var(--color-border)]">
      <table className="w-full text-[12px]">
        <thead className="bg-gray-50">
          <tr>
            <th className="w-8 px-2 py-1.5 text-left text-gray-400">#</th>
            {columns.map((col, i) => (
              <th
                key={i}
                className={`px-2 py-1.5 font-medium text-gray-600 ${
                  isNumericColumnType(types[i]) ? "text-right" : "text-left"
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filledRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-gray-100">
              <td className="px-2 py-1.5 text-gray-400">{rowIndex + 1}</td>
              {columns.map((_, colIndex) => (
                <td
                  key={colIndex}
                  className={`px-2 py-1.5 text-gray-800 ${
                    // Chuẩn V1.1 (Phần D): "số liệu quan trọng đậm 600–700".
                    // Đây là thứ người duyệt nhìn đầu tiên; trước đây số tiền và
                    // tên hàng cùng một độ đậm nên mắt không biết bám vào đâu.
                    isNumericColumnType(types[colIndex])
                      ? "text-right font-bold tabular-nums"
                      : ""
                  }`}
                >
                  {formatCellForDisplay(row[colIndex] ?? "", types[colIndex]) || "—"}
                </td>
              ))}
            </tr>
          ))}
          {hasMoneyColumn && (
            <tr className="border-t border-[var(--color-border)] bg-gray-50 font-bold">
              <td className="px-2 py-1.5" />
              {columns.map((_, colIndex) => {
                const total = types[colIndex] === "money" ? sumColumn(filledRows, colIndex) : null;
                return (
                  <td
                    key={colIndex}
                    className={`px-2 py-1.5 ${
                      total === null ? "text-gray-500" : "text-right tabular-nums text-gray-900"
                    }`}
                  >
                    {total === null
                      ? colIndex === 0
                        ? "Tổng cộng"
                        : ""
                      : formatCellForDisplay(String(total), "money")}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
