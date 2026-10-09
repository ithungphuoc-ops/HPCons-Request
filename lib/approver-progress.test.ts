import { describe, expect, it } from "vitest";
import {
  buildApproverProgress,
  formatHours,
  formatOverdue,
  HISTORY_ACTION,
  progressTimeLabel,
  type ProgressGroupSettings,
} from "./approver-progress";
import { addBusinessHours, businessHoursBetween } from "./business-hours";
import type { ApproverState } from "./approval-logic";
import type { RequestHistoryEntry, RequestInstance, TaggedUser } from "./types";

const NAMES = ["Trương Văn Vũ Em", "Phan Đình Trí", "Đỗ Ngọc Tấn", "Hồ Văn Thi", "Bùi Thị Trí Tâm", "Hồ Minh Sang"];
const SLA = [5, 5, 16, 7, 8, 8];
const H = 3_600_000;
/** Giờ VN tường minh (tháng 0-based như Date), không phụ thuộc múi giờ máy chạy test. */
const vnt = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, mo, d, h - 7, mi));
const T0 = new Date("2026-10-05T07:13:00.000Z"); // 14:13 giờ VN
const at = (hours: number) => new Date(T0.getTime() + hours * H).toISOString();

function user(i: number): TaggedUser {
  return { id: `u${i}`, name: NAMES[i], username: `u${i}`, avatarInitial: NAMES[i][0] } as TaggedUser;
}

type Req = Parameters<typeof buildApproverProgress>[0];

function makeRequest(opts: {
  flow?: RequestInstance["approvalFlow"];
  decisions: ApproverState["decision"][];
  history?: RequestHistoryEntry[];
  status?: RequestInstance["status"];
  deadlineAt?: string | null;
  withSla?: boolean;
}): Req {
  const n = opts.decisions.length;
  const snapshot = Array.from({ length: n }, (_, i) => user(i));
  return {
    approvalFlow: opts.flow ?? "sequential",
    approversSnapshot: snapshot,
    approvers: snapshot.map((u, i) => ({ id: u.id, decision: opts.decisions[i] })),
    approverStepMeta: opts.withSla === false ? undefined : snapshot.map((_, i) => ({ slaHours: SLA[i] })),
    history: [
      { at: at(0), actor: "Trần Thanh Hậu", action: HISTORY_ACTION.submitted },
      ...(opts.history ?? []),
    ],
    submittedAt: at(0),
    status: opts.status ?? "pending",
    deadlineAt: opts.deadlineAt ?? null,
  };
}

const GROUP: ProgressGroupSettings = {
  slaByWorkCalendar: false,
  approverSlaEnabled: true,
  slaHours: null,
  approverSteps: SLA.map((s) => ({ kind: "submitter_manager", slaHours: s })),
};

const approve = (i: number, h: number): RequestHistoryEntry => ({
  at: at(h),
  actor: NAMES[i],
  action: HISTORY_ACTION.approved,
});

describe("buildApproverProgress — luồng Lần lượt", () => {
  it("đang ở bước 1: người 1 đang tới lượt, còn lại Chưa tới lượt", () => {
    const req = makeRequest({ decisions: Array(6).fill("pending"), deadlineAt: at(5) });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(0.98)));
    expect(rows[0].status).toBe("current");
    expect(rows[0].actualHours).toBeCloseTo(0.98, 5);
    expect(rows[0].slaHours).toBe(5);
    expect(rows[0].deadlineAt).toBe(at(5));
    expect(rows[0].late).toBe(false);
    expect(progressTimeLabel(rows[0])).toBe("Đang tới lượt · trong hạn");
    for (const r of rows.slice(1)) {
      expect(r.status).toBe("waiting");
      expect(r.actualHours).toBeNull();
      expect(progressTimeLabel(r)).toBe("Chưa tới lượt");
    }
    expect(rows[2].slaHours).toBe(16);
  });

  it("đã qua 2 bước, bước 3 quá hạn", () => {
    const req = makeRequest({
      decisions: ["approved", "approved", "pending", "pending", "pending", "pending"],
      history: [approve(0, 2.4), approve(1, 6.5)],
      deadlineAt: at(6.5 + 16),
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(6.5 + 19.5)));
    expect(rows[0].actualHours).toBeCloseTo(2.4, 5);
    expect(rows[1].startAt).toBe(at(2.4));
    expect(rows[1].actualHours).toBeCloseTo(4.1, 5);
    expect(progressTimeLabel(rows[0])).toBe("Đã duyệt · đúng hạn");
    expect(rows[2].status).toBe("current");
    expect(rows[2].startAt).toBe(at(6.5));
    expect(rows[2].actualHours).toBeCloseTo(19.5, 5);
    expect(rows[2].late).toBe(true);
    expect(progressTimeLabel(rows[2])).toBe("Quá hạn");
    // Từ 09/10/2026 dùng chung cách hiện với nhãn danh sách: bỏ phút lẻ khi >= 1 giờ.
    expect(formatOverdue(rows[2].deadlineAt!, new Date(at(26)).getTime())).toBe("Quá hạn 3 giờ");
    expect(rows[3].status).toBe("waiting");
  });

  it("đã duyệt nhưng vượt SLA bước → trễ hạn", () => {
    const req = makeRequest({
      decisions: ["approved", "pending"],
      history: [approve(0, 6)],
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(7)));
    expect(rows[0].late).toBe(true);
    expect(progressTimeLabel(rows[0])).toBe("Đã duyệt · trễ hạn");
  });

  it("từ chối ở bước 4 → bước 5-6 Không cần duyệt", () => {
    const req = makeRequest({
      decisions: ["approved", "approved", "approved", "rejected", "pending", "pending"],
      status: "rejected",
      history: [
        approve(0, 2.4),
        approve(1, 6.5),
        approve(2, 17.7),
        { at: at(20.7), actor: NAMES[3], action: HISTORY_ACTION.rejected, note: "Sai số" },
      ],
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(30)));
    expect(rows[3].status).toBe("rejected");
    expect(rows[3].actualHours).toBeCloseTo(3, 5);
    expect(progressTimeLabel(rows[3])).toBe("Từ chối");
    expect(rows[4].status).toBe("skipped");
    expect(rows[5].status).toBe("skipped");
    expect(progressTimeLabel(rows[5])).toBe("Không cần duyệt");
    expect(rows[5].actualHours).toBeNull();
  });

  it("duyệt xong hết: mọi người xanh, giờ khớp lịch sử", () => {
    const marks = [2.4, 6.5, 17.7, 20.7, 27.2, 28.4];
    const req = makeRequest({
      decisions: Array(6).fill("approved"),
      status: "approved",
      history: marks.map((h, i) => approve(i, h)),
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(40)));
    const expected = [2.4, 4.1, 11.2, 3, 6.5, 1.2];
    rows.forEach((r, i) => {
      expect(r.status).toBe("approved");
      expect(r.actualHours).toBeCloseTo(expected[i], 5);
      expect(r.deadlineAt).toBeNull();
    });
  });

  it("trả lại rồi gửi lại: chỉ tính vòng sau lần gửi lại gần nhất", () => {
    const req = makeRequest({
      decisions: ["approved", "pending", "pending"],
      history: [
        approve(0, 1),
        { at: at(2), actor: NAMES[1], action: HISTORY_ACTION.returned, note: "Bổ sung" },
        { at: at(10), actor: "Trần Thanh Hậu", action: HISTORY_ACTION.resubmitted },
        approve(0, 13),
      ],
      deadlineAt: at(18),
    });
    const { rows, cycleStartAt } = buildApproverProgress(req, GROUP, new Date(at(14)));
    expect(cycleStartAt).toBe(at(10));
    expect(rows[0].startAt).toBe(at(10));
    expect(rows[0].actualHours).toBeCloseTo(3, 5);
    expect(rows[1].status).toBe("current");
    expect(rows[1].startAt).toBe(at(13));
    expect(rows[2].status).toBe("waiting");
  });

  it("đang ở trạng thái Trả lại: suy quyết định vòng vừa rồi từ lịch sử", () => {
    const req = makeRequest({
      decisions: ["pending", "pending", "pending"],
      status: "returned",
      history: [approve(0, 1), { at: at(2), actor: NAMES[1], action: HISTORY_ACTION.returned, note: "x" }],
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(5)));
    expect(rows[0].status).toBe("approved");
    expect(rows[1].status).toBe("returned");
    expect(rows[1].actualHours).toBeCloseTo(1, 5);
    expect(rows[2].status).toBe("waiting");
  });

  it("Chuyển tiếp cho duyệt trước: người nhận bắt đầu lúc được chuyển, người chuyển quay lại sau", () => {
    // Thứ tự sau khi chèn: u0, X (được chèn), u1(người chuyển)
    const snapshot = [user(0), { ...user(5), id: "x" }, user(1)];
    const req: Req = {
      approvalFlow: "sequential",
      approversSnapshot: snapshot,
      approvers: [
        { id: "u0", decision: "approved" },
        { id: "x", decision: "approved" },
        { id: "u1", decision: "pending" },
      ],
      approverStepMeta: [{ slaHours: 5 }, {}, { slaHours: 5 }],
      history: [
        { at: at(0), actor: "Hậu", action: HISTORY_ACTION.submitted },
        approve(0, 1),
        { at: at(2), actor: NAMES[1], action: HISTORY_ACTION.forwardThenApprove, target: NAMES[5] },
        approve(5, 4),
      ],
      submittedAt: at(0),
      status: "pending",
      deadlineAt: null,
    };
    const { rows } = buildApproverProgress(req, { ...GROUP, slaHours: 24 }, new Date(at(6)));
    expect(rows[1].startAt).toBe(at(2));
    expect(rows[1].actualHours).toBeCloseTo(2, 5);
    expect(rows[1].slaHours).toBe(24); // meta rỗng → SLA chung, đúng như route decision tính lại
    expect(rows[2].status).toBe("current");
    expect(rows[2].startAt).toBe(at(4));
    expect(rows[2].late).toBeNull(); // không có deadlineAt → không xét quá hạn
  });

  it("trùng tên 2 người: ghép theo thứ tự lần lượt, không crash", () => {
    const snapshot = [user(0), { ...user(0), id: "dup" }];
    const req: Req = {
      approvalFlow: "sequential",
      approversSnapshot: snapshot,
      approvers: [
        { id: "u0", decision: "approved" },
        { id: "dup", decision: "approved" },
      ],
      approverStepMeta: undefined,
      history: [{ at: at(0), actor: "Hậu", action: HISTORY_ACTION.submitted }, approve(0, 1), approve(0, 3)],
      submittedAt: at(0),
      status: "approved",
      deadlineAt: null,
    };
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(5)));
    expect(rows[0].actualHours).toBeCloseTo(1, 5);
    expect(rows[1].actualHours).toBeCloseTo(2, 5);
  });

  it("không tìm được mốc trong lịch sử → null, không bịa", () => {
    const req = makeRequest({ decisions: ["approved", "pending"], history: [] });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(3)));
    expect(rows[0].actualHours).toBeNull();
    expect(rows[1].status).toBe("current");
    expect(rows[1].startAt).toBeNull();
    expect(formatHours(rows[1].actualHours)).toBe("—");
  });
});

describe("buildApproverProgress — SLA", () => {
  it("không có SLA (nhóm tắt SLA riêng bước, luồng lần lượt) → SLA '—', đã duyệt không xếp đúng/trễ", () => {
    const req = makeRequest({ decisions: ["approved", "pending"], history: [approve(0, 2)], deadlineAt: at(24) });
    const { rows } = buildApproverProgress(req, { slaByWorkCalendar: false, approverSlaEnabled: false, slaHours: 24 }, new Date(at(3)));
    expect(rows[0].slaHours).toBeNull();
    expect(progressTimeLabel(rows[0])).toBe("Đã duyệt");
    // Hạn chung vẫn gắn với người đang tới lượt
    expect(rows[1].deadlineAt).toBe(at(24));
    expect(rows[1].late).toBe(false);
  });

  it("đề xuất trực tiếp (không nhóm, không SLA) → mọi cột SLA '—'", () => {
    const req = makeRequest({ decisions: ["pending", "pending"], withSla: false, flow: "concurrent" });
    const { rows, workCalendar } = buildApproverProgress(req, null, new Date(at(1.5)));
    expect(workCalendar).toBe(false);
    expect(rows.every((r) => r.slaHours === null)).toBe(true);
    expect(rows.every((r) => r.status === "current")).toBe(true);
    expect(rows[1].actualHours).toBeCloseTo(1.5, 5);
    expect(progressTimeLabel(rows[0])).toBe("Đang tới lượt");
  });

  it("luồng Đồng thời: mọi người bắt đầu lúc gửi, SLA = SLA lúc gửi", () => {
    const req = makeRequest({
      flow: "concurrent",
      decisions: ["approved", "pending", "approved"],
      history: [approve(2, 1), approve(0, 3)],
      deadlineAt: at(5),
    });
    const { rows } = buildApproverProgress(req, GROUP, new Date(at(4)));
    expect(rows[0].startAt).toBe(at(0));
    expect(rows[0].actualHours).toBeCloseTo(3, 5);
    expect(rows[2].actualHours).toBeCloseTo(1, 5);
    expect(rows[1].status).toBe("current");
    expect(rows[1].actualHours).toBeCloseTo(4, 5);
    expect(rows.every((r) => r.slaHours === 5)).toBe(true); // approverSteps[0].slaHours
  });

  it("lịch làm việc vs giờ đồng hồ: qua đêm chỉ tính giờ hành chính", () => {
    // Thứ 2 16:15 → Thứ 3 08:45 (giờ máy) = 1h chiều T2 + 1h sáng T3 = 2h làm việc; đồng hồ = 16.5h
    const monday = vnt(2026, 9, 5, 16, 15); // 05/10/2026 là Thứ 2
    const tuesday = vnt(2026, 9, 6, 8, 45);
    const req: Req = {
      approvalFlow: "sequential",
      approversSnapshot: [user(0)],
      approvers: [{ id: "u0", decision: "approved" }],
      approverStepMeta: [{ slaHours: 4 }],
      history: [
        { at: monday.toISOString(), actor: "Hậu", action: HISTORY_ACTION.submitted },
        { at: tuesday.toISOString(), actor: NAMES[0], action: HISTORY_ACTION.approved },
      ],
      submittedAt: monday.toISOString(),
      status: "approved",
      deadlineAt: null,
    };
    const work = buildApproverProgress(req, { ...GROUP, slaByWorkCalendar: true, approverSteps: [{ kind: "submitter_manager", slaHours: 4 }] }, tuesday);
    const clock = buildApproverProgress(req, { ...GROUP, slaByWorkCalendar: false, approverSteps: [{ kind: "submitter_manager", slaHours: 4 }] }, tuesday);
    expect(work.workCalendar).toBe(true);
    expect(work.rows[0].actualHours).toBeCloseTo(2, 5);
    expect(work.rows[0].late).toBe(false);
    expect(clock.rows[0].actualHours).toBeCloseTo(16.5, 5);
    expect(clock.rows[0].late).toBe(true);
  });
});

describe("businessHoursBetween", () => {
  it("là chiều ngược của addBusinessHours", () => {
    const from = vnt(2026, 9, 3, 15, 20); // Thứ 7
    for (const h of [0.5, 3, 8.5, 17, 40]) {
      expect(businessHoursBetween(from, addBusinessHours(from, h))).toBeCloseTo(h, 5);
    }
  });

  it("bỏ nghỉ trưa và Chủ nhật; to <= from → 0", () => {
    expect(businessHoursBetween(vnt(2026, 9, 5, 11, 0), vnt(2026, 9, 5, 14, 0))).toBeCloseTo(2, 5);
    expect(businessHoursBetween(vnt(2026, 9, 4, 9, 0), vnt(2026, 9, 4, 15, 0))).toBe(0); // Chủ nhật
    expect(businessHoursBetween(vnt(2026, 9, 5, 9, 0), vnt(2026, 9, 5, 8, 0))).toBe(0);
  });
});
