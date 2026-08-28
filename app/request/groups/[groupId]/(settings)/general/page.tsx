"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import RichTextEditor from "@/components/shared/RichTextEditor";
import ApproverStepsEditor, {
  fromApproverSteps,
  toApproverSteps,
  type DraftApproverStep,
} from "@/components/request/ApproverStepsEditor";
import FollowersConditionalEditor, {
  type FollowersConditionalItem,
} from "@/components/request/FollowersConditionalEditor";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/shared/form-styles";
import { categoryOptions } from "@/lib/mock-data";
import { approverStepDisplayName, fixedStepUsers } from "@/lib/approval-logic";
import {
  approvalFlowDescriptions,
  approvalFlowLabels,
  type ApprovalFlowType,
  type ApproverStepDef,
  type ProposalGroup,
  type TaggedUser,
} from "@/lib/types";
import { validateGroupName, validateSlaHours } from "@/lib/validation";

const flowOptions: ApprovalFlowType[] = ["concurrent", "sequential", "single"];

const decisionNoteOptions: [keyof NonNullable<ProposalGroup["requireDecisionNote"]>, string][] = [
  ["approve", "Chấp thuận"],
  ["reject", "Từ chối"],
  ["forward", "Chuyển tiếp"],
  ["approveAndForward", "Chấp thuận và chuyển tiếp"],
];

const cardClass = "rounded-[3px] border border-[var(--color-border)] bg-white p-4";
const cardHeadClass = "mb-3 flex items-start justify-between gap-3";
const cardTitleClass = "text-[13px] font-semibold uppercase tracking-wide text-gray-500";
const cardDescClass = "mt-0.5 text-[12px] text-gray-400";
const editLinkClass = "shrink-0 text-[12.5px] font-medium text-[var(--color-action-blue)] hover:underline";

type ModalKind = null | "general" | "flow" | "followers";

export default function GeneralSettingsPage() {
  return (
    <RequireAdminRole>
      <GeneralSettingsPageInner />
    </RequireAdminRole>
  );
}

function GeneralSettingsPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);
  const [modal, setModal] = useState<ModalKind>(null);

  if (!group) return null;

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-gray-800">Thiết lập chung</h2>
        <p className="text-[12px] text-gray-400">Thông tin chung và luồng duyệt của nhóm đề xuất.</p>
      </div>

      <GeneralInfoCard group={group} onEdit={() => setModal("general")} />
      <ApproverStepsCard group={group} updateGroup={updateGroup} />
      <ApprovalFlowCard group={group} onEdit={() => setModal("flow")} />
      <FollowersCard group={group} onEdit={() => setModal("followers")} />

      {modal === "general" && (
        <EditGeneralModal group={group} onClose={() => setModal(null)} updateGroup={updateGroup} />
      )}
      {modal === "flow" && (
        <EditApprovalFlowModal group={group} onClose={() => setModal(null)} updateGroup={updateGroup} />
      )}
      {modal === "followers" && (
        <EditFollowersModal group={group} onClose={() => setModal(null)} updateGroup={updateGroup} />
      )}
    </div>
  );
}

/* ---------------------------- Thông tin chung ---------------------------- */

function GeneralInfoCard({ group, onEdit }: { group: ProposalGroup; onEdit: () => void }) {
  return (
    <div className={cardClass}>
      <div className={cardHeadClass}>
        <div>
          <h3 className={cardTitleClass}>Thông tin chung</h3>
          <p className={cardDescClass}>Thiết lập các thông tin chung về nhóm đề xuất</p>
        </div>
        <button type="button" onClick={onEdit} className={editLinkClass}>
          Chỉnh sửa
        </button>
      </div>
      <dl className="flex flex-col">
        <InfoRow label="Tên nhóm đề xuất" value={group.name} />
        <InfoRow label="Tạo bởi" value={group.createdBy?.name ?? "—"} />
        <InfoRow label="Phân loại" value={group.category || "—"} />
        <InfoRow label="Thời hạn xử lý" value={group.slaHours != null ? `${group.slaHours} giờ` : "—"} />
        <InfoRow
          label="Sử dụng cho"
          value={group.usedFor.length > 0 ? group.usedFor.map((u) => u.name).join(", ") : "Toàn công ty"}
        />
        <InfoRow label="Trạng thái" value={group.status === "active" ? "🟢 Đang khả dụng" : "🔴 Đang tạm đóng"} />
      </dl>
    </div>
  );
}

function EditGeneralModal({
  group,
  onClose,
  updateGroup,
}: {
  group: ProposalGroup;
  onClose: () => void;
  updateGroup: (id: string, patch: Partial<ProposalGroup>) => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [category, setCategory] = useState(group.category);
  const [slaHours, setSlaHours] = useState(group.slaHours != null ? String(group.slaHours) : "");
  const [usedFor, setUsedFor] = useState<TaggedUser[]>(group.usedFor);
  const [requiresSubmissionForm, setRequiresSubmissionForm] = useState(group.requiresSubmissionForm ?? true);
  const [descriptionHtml, setDescriptionHtml] = useState(group.descriptionHtml ?? "");
  const [status, setStatus] = useState<ProposalGroup["status"]>(group.status);
  const [errors, setErrors] = useState<{ name?: string; sla?: string }>({});

  const handleSave = () => {
    const nameCheck = validateGroupName(name);
    const slaValue = slaHours.trim() === "" ? null : Number(slaHours);
    const slaCheck = validateSlaHours(slaValue);
    if (!nameCheck.valid || !slaCheck.valid) {
      setErrors({ name: nameCheck.error, sla: slaCheck.error });
      return;
    }
    updateGroup(group.id, {
      name: name.trim(),
      description,
      category,
      slaHours: slaValue,
      usedFor,
      requiresSubmissionForm,
      descriptionHtml,
      status,
    });
    onClose();
  };

  return (
    <Modal
      title="Chỉnh sửa thông tin"
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Huỷ bỏ
          </button>
          <button type="button" onClick={handleSave} className={confirmButtonClass}>
            Chỉnh sửa thông tin
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên nhóm đề xuất" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          {errors.name && <ErrorText>{errors.name}</ErrorText>}
        </Field>

        <Field label="Mô tả" description="Mô tả ngắn, hiển thị trong danh sách/tìm kiếm nhóm.">
          <textarea
            className={textareaClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Phân loại">
          <input
            className={inputClass}
            list="general-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="general-category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="Thời hạn xử lý (giờ)">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={slaHours}
            onChange={(e) => setSlaHours(e.target.value)}
          />
          {errors.sla && <ErrorText>{errors.sla}</ErrorText>}
        </Field>

        <Field label="Sử dụng cho" description="Để trống nghĩa là toàn công ty được tạo.">
          <TagUserInput value={usedFor} onChange={setUsedFor} />
        </Field>

        <Field label="Mẫu form đề xuất?" description="Người gửi có bắt buộc điền các trường tuỳ chỉnh của nhóm không?">
          <select
            className={selectClass}
            value={requiresSubmissionForm ? "yes" : "no"}
            onChange={(e) => setRequiresSubmissionForm(e.target.value === "yes")}
          >
            <option value="yes">Có</option>
            <option value="no">Không</option>
          </select>
        </Field>

        <Field
          label="Mô tả nhóm đề xuất"
          description="Hiển thị nổi bật ở đầu form Gửi đề xuất — hỗ trợ định dạng, giống Base.vn."
        >
          <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
        </Field>

        <Field label="Trạng thái">
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProposalGroup["status"])}
          >
            <option value="active">🟢 Đang khả dụng</option>
            <option value="closed">🔴 Đang tạm đóng</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------- Người duyệt ------------------------------ */

function ApproverStepsCard({
  group,
  updateGroup,
}: {
  group: ProposalGroup;
  updateGroup: (id: string, patch: Partial<ProposalGroup>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState<DraftApproverStep[]>(() => fromApproverSteps(group.approverSteps));
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string>();

  const beginEdit = (extraStep?: DraftApproverStep) => {
    const base = fromApproverSteps(group.approverSteps);
    setSteps(extraStep ? [...base, extraStep] : base);
    setError(undefined);
    setEditing(true);
    setMenuOpen(false);
  };

  const handleAddFromMenu = (kind: DraftApproverStep["kind"]) => {
    if (kind === "submitter_manager") beginEdit({ kind: "submitter_manager" });
    else if (kind === "flexible_approver") beginEdit({ kind: "flexible_approver", name: "", users: [] });
    else beginEdit({ kind: "fixed", users: [] });
  };

  const handleSave = () => {
    const parsed = toApproverSteps(steps);
    if (!parsed) {
      setError("Còn bước duyệt chưa chọn người cố định, hoặc bước linh động chưa đặt tên.");
      return;
    }
    updateGroup(group.id, { approverSteps: parsed });
    setEditing(false);
  };

  const handleCancel = () => {
    setSteps(fromApproverSteps(group.approverSteps));
    setError(undefined);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={cardClass}>
        <div className={cardHeadClass}>
          <div>
            <h3 className={cardTitleClass}>Người duyệt</h3>
            <p className={cardDescClass}>Danh sách các khối người duyệt theo thứ tự của nhóm đề xuất</p>
          </div>
        </div>
        <ApproverStepsEditor value={steps} onChange={setSteps} fields={group.fields} />
        {error && <ErrorText>{error}</ErrorText>}
        <div className="mt-3 flex items-center gap-3 border-t border-[var(--color-border)] pt-3">
          <button type="button" onClick={handleSave} className={confirmButtonClass}>
            Lưu thay đổi
          </button>
          <button type="button" onClick={handleCancel} className={cancelButtonClass}>
            Huỷ bỏ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className={cardHeadClass}>
        <div>
          <h3 className={cardTitleClass}>Người duyệt</h3>
          <p className={cardDescClass}>Danh sách các khối người duyệt theo thứ tự của nhóm đề xuất</p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`${confirmButtonClass} flex items-center gap-1`}
          >
            <Plus size={14} /> Thêm <ChevronDown size={13} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-[230px] rounded border border-[var(--color-border)] bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => handleAddFromMenu("fixed")}
                  className="block w-full px-3 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                >
                  Thêm người duyệt cố định
                </button>
                <button
                  type="button"
                  onClick={() => handleAddFromMenu("submitter_manager")}
                  className="block w-full px-3 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                >
                  Thêm quản lý trực tiếp
                </button>
                <button
                  type="button"
                  onClick={() => handleAddFromMenu("flexible_approver")}
                  className="block w-full px-3 py-2 text-left text-[13px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
                >
                  Thêm người duyệt linh động
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {group.approverSteps.length === 0 ? (
        <p className="text-[13px] text-gray-400">Chưa có bước duyệt nào.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {group.approverSteps.map((step, index) => (
            <StepRow
              key={index}
              step={step}
              index={index}
              showSla={group.approverSlaEnabled ?? false}
              onClick={() => beginEdit()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({
  step,
  index,
  showSla,
  onClick,
}: {
  step: ApproverStepDef;
  index: number;
  showSla: boolean;
  onClick: () => void;
}) {
  const isFlexible = step.kind === "flexible_approver";
  const isManager = step.kind === "submitter_manager";
  // Ý nghĩa của `step.users` ĐỔI khi `submitterAssigns` bật — không còn là
  // danh sách người duyệt thật, mà là danh sách GIỚI HẠN ai được người gửi đề
  // xuất chọn (rỗng = không giới hạn) — xem ApproverStepDef.flexible_approver.
  const isSubmitterAssign = step.kind === "flexible_approver" && !!step.submitterAssigns;
  const people = step.kind === "fixed" ? fixedStepUsers(step) : isFlexible ? step.users : [];
  const displayName = step.name?.trim() || (isManager ? "Quản lý trực tiếp" : approverStepDisplayName(step, index));
  const initials = people[0]?.name?.trim().slice(0, 2).toUpperCase() ?? "";

  let meta: string;
  if (isManager) meta = "Tự động: trưởng đơn vị của người gửi";
  else if (isSubmitterAssign) {
    meta =
      people.length === 0
        ? "Người gửi đề xuất tự chọn — không giới hạn"
        : `Người gửi đề xuất tự chọn trong: ${people.map((u) => u.name).join(", ")}`;
  } else if (isFlexible && people.length === 0) meta = "Chưa cài đặt danh sách duyệt";
  else meta = people.map((u) => u.name).join(", ") || "—";
  if (step.code) meta += ` · ${step.code}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded border border-[var(--color-border)] p-3 text-left transition-colors hover:border-[var(--color-action-blue)]"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
          isFlexible || isManager ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-[var(--color-action-blue)]"
        }`}
      >
        {isFlexible || isManager ? <Users size={16} /> : initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-gray-800">
          {displayName}
          {isFlexible && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">
              LINH ĐỘNG
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] text-gray-400">{meta}</span>
      </span>
      {showSla && step.slaHours != null && (
        <span className="shrink-0 rounded bg-blue-50 px-2.5 py-1 text-[11.5px] font-bold text-[var(--color-action-blue)]">
          Hạn xử lý: {step.slaHours} giờ
        </span>
      )}
    </button>
  );
}

/* ------------------------------ Luồng phê duyệt ---------------------------- */

function ApprovalFlowCard({ group, onEdit }: { group: ProposalGroup; onEdit: () => void }) {
  return (
    <div className={cardClass}>
      <div className={cardHeadClass}>
        <div>
          <h3 className={cardTitleClass}>Luồng phê duyệt</h3>
          <p className={cardDescClass}>Thiết lập luồng phê duyệt đề xuất</p>
        </div>
        <button type="button" onClick={onEdit} className={editLinkClass}>
          Chỉnh sửa
        </button>
      </div>
      <dl className="flex flex-col">
        <InfoRow label="Quy trình xử lý" value={approvalFlowLabels[group.approvalFlow]} />
      </dl>
    </div>
  );
}

function EditApprovalFlowModal({
  group,
  onClose,
  updateGroup,
}: {
  group: ProposalGroup;
  onClose: () => void;
  updateGroup: (id: string, patch: Partial<ProposalGroup>) => void;
}) {
  const [approvalFlow, setApprovalFlow] = useState<ApprovalFlowType>(group.approvalFlow);
  const [approverSlaEnabled, setApproverSlaEnabled] = useState(group.approverSlaEnabled ?? false);
  const [slaByWorkCalendar, setSlaByWorkCalendar] = useState(group.slaByWorkCalendar ?? false);
  const [requireDecisionNote, setRequireDecisionNote] = useState(group.requireDecisionNote ?? {});
  const [notifyManager, setNotifyManager] = useState(group.notifyManager);

  const handleSave = () => {
    updateGroup(group.id, {
      approvalFlow,
      approverSlaEnabled,
      slaByWorkCalendar,
      requireDecisionNote,
      notifyManager,
    });
    onClose();
  };

  return (
    <Modal
      title="Chỉnh sửa luồng phê duyệt"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Huỷ bỏ
          </button>
          <button type="button" onClick={handleSave} className={confirmButtonClass}>
            Chỉnh sửa
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Quy trình xử lý" description={approvalFlowDescriptions[approvalFlow]}>
          <select
            className={selectClass}
            value={approvalFlow}
            onChange={(e) => setApprovalFlow(e.target.value as ApprovalFlowType)}
          >
            {flowOptions.map((flow) => (
              <option key={flow} value={flow}>
                {approvalFlowLabels[flow]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Thời hạn xử lý riêng từng bước duyệt"
          description="Bật/tắt thời hạn xử lý riêng cho từng bước duyệt (độc lập thời hạn chung của đề xuất)."
        >
          <select
            className={selectClass}
            value={approverSlaEnabled ? "yes" : "no"}
            onChange={(e) => setApproverSlaEnabled(e.target.value === "yes")}
          >
            <option value="no">Tắt</option>
            <option value="yes">Kích hoạt</option>
          </select>
        </Field>

        <Field
          label="Thời hạn xử lý theo lịch làm việc"
          description="Bỏ giờ ngoài hành chính/ngày nghỉ khi tính hạn xử lý."
        >
          <select
            className={selectClass}
            value={slaByWorkCalendar ? "yes" : "no"}
            onChange={(e) => setSlaByWorkCalendar(e.target.value === "yes")}
          >
            <option value="no">Không</option>
            <option value="yes">Có</option>
          </select>
        </Field>

        <Field
          label="Bắt buộc nhập ý kiến phê duyệt"
          description="Chặn người duyệt bỏ trống ghi chú khi thực hiện hành động tương ứng."
        >
          <div className="flex flex-col gap-1.5">
            {decisionNoteOptions.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-[13px] text-gray-700">
                <input
                  type="checkbox"
                  checked={requireDecisionNote[key] ?? false}
                  onChange={(e) => setRequireDecisionNote({ ...requireDecisionNote, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Báo quản lý trực tiếp">
          <select
            className={selectClass}
            value={notifyManager ? "yes" : "no"}
            onChange={(e) => setNotifyManager(e.target.value === "yes")}
          >
            <option value="yes">Có</option>
            <option value="no">Không</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------ Người theo dõi ----------------------------- */

function FollowersCard({ group, onEdit }: { group: ProposalGroup; onEdit: () => void }) {
  return (
    <div className={cardClass}>
      <div className={cardHeadClass}>
        <div>
          <h3 className={cardTitleClass}>Người theo dõi</h3>
          <p className={cardDescClass}>Người theo dõi mặc định và theo điều kiện của nhóm đề xuất</p>
        </div>
        <button type="button" onClick={onEdit} className={editLinkClass}>
          Chỉnh sửa
        </button>
      </div>
      <dl className="flex flex-col">
        <InfoRow
          label="Mặc định"
          value={group.followers.length > 0 ? group.followers.map((u) => u.name).join(", ") : "Chưa có"}
        />
        <InfoRow
          label="Theo điều kiện"
          value={
            group.followersConditional?.length
              ? `${group.followersConditional.length} điều kiện đang cấu hình`
              : "Chưa có"
          }
        />
      </dl>
    </div>
  );
}

function EditFollowersModal({
  group,
  onClose,
  updateGroup,
}: {
  group: ProposalGroup;
  onClose: () => void;
  updateGroup: (id: string, patch: Partial<ProposalGroup>) => void;
}) {
  const [followers, setFollowers] = useState<TaggedUser[]>(group.followers);
  const [followersConditional, setFollowersConditional] = useState<FollowersConditionalItem[]>(
    group.followersConditional ?? [],
  );

  const handleSave = () => {
    updateGroup(group.id, { followers, followersConditional });
    onClose();
  };

  return (
    <Modal
      title="Chỉnh sửa người theo dõi"
      width={640}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Huỷ bỏ
          </button>
          <button type="button" onClick={handleSave} className={confirmButtonClass}>
            Chỉnh sửa
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Người theo dõi">
          <TagUserInput value={followers} onChange={setFollowers} />
        </Field>

        <Field
          label="Người theo dõi theo điều kiện"
          description="Chỉ thêm những người này làm người theo dõi khi đề xuất thoả điều kiện tương ứng."
        >
          <FollowersConditionalEditor value={followersConditional} onChange={setFollowersConditional} fields={group.fields} />
        </Field>
      </div>
    </Modal>
  );
}

/* --------------------------------- Dùng chung ------------------------------- */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <dt className="w-[200px] shrink-0 text-[12.5px] text-gray-400">{label}</dt>
      <dd className="text-[13px] font-medium text-gray-800">{value}</dd>
    </div>
  );
}

function Field({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
      </label>
      {description && <p className="mb-1 text-[12px] text-gray-400">{description}</p>}
      {children}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{children}</p>;
}
