import { describe, expect, it, vi } from "vitest";
import type { ProposalField, RequestInstance } from "./types";

// `lib/r2.ts` khai `import "server-only"` ở đầu file — chặn được import từ Client Component
// thật, nhưng cũng khiến file không tải được trong môi trường test `jsdom` (bị coi là phía
// client). Không test đường tải tệp đính kèm ở đây (không liên quan payload gửi Thu mua),
// nên giả (mock) hẳn module này để tránh chạm vào guard đó — cùng vấn đề sẽ gặp nếu ai đó
// test `qlkctr-sync.ts`, không phải lỗi riêng của file mới này.
vi.mock("@/lib/r2", () => ({ createSignedReadUrl: vi.fn() }));

// Cùng lý do với @/lib/r2 ở trên — lib/firebase/admin.ts cũng khai `import "server-only"`.
// updateMock cho phép từng test kiểm được đã ghi đúng field/history chưa.
const updateMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: { collection: () => ({ doc: () => ({ update: updateMock }) }) },
}));

const { trichXuatPayloadThuMua, retryThuMuaSyncNeuLoi } = await import("./thumua-sync");

function baseRequest(overrides: Partial<RequestInstance>): RequestInstance {
  return {
    id: "req-1",
    code: "012345",
    groupId: "g1",
    groupNameSnapshot: "TM-QT Mua hang",
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "uid-abc", email: "a@hpcons.com.vn", name: "Nguyen Van A" },
    submittedAt: "2026-08-18T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    approvalFlow: "sequential" as RequestInstance["approvalFlow"],
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved" as RequestInstance["status"],
    deadlineAt: null,
    history: [],
    comments: [],
    ...overrides,
  } as RequestInstance;
}

const detailField: ProposalField = {
  id: "f_ct",
  code: "chi_tiet",
  name: "Chi tiết",
  dataType: "table",
  tableColumns: ["Tên hàng", "Quy cách", "ĐVT", "Số lượng", "Mục đích"],
} as unknown as ProposalField;

const deptField: ProposalField = {
  id: "f_bp",
  code: null,
  name: "Chọn bộ phận",
  dataType: "department_select",
} as unknown as ProposalField;

const titleField: ProposalField = {
  id: "f_ten",
  code: "ten_de_xuat",
  name: "Tên đề xuất",
  dataType: "short_text",
} as unknown as ProposalField;

describe("trichXuatPayloadThuMua", () => {
  it("gửi đề xuất có công trình, kèm tên công trình", async () => {
    const req = baseRequest({
      fieldsSnapshot: [titleField, deptField, detailField],
      values: {
        f_ten: "30/2025/HĐXD/UNICE-HPCS - UNICE QUẢNG NGÃI",
        f_bp: "Bộ phận Thi công",
        f_ct: [["Xi măng PC40", "50kg/bao", "bao", "50", "Đổ móng"]],
      },
    });

    const payload = await trichXuatPayloadThuMua(req);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBe("30/2025/HĐXD/UNICE-HPCS - UNICE QUẢNG NGÃI");
    expect(payload?.phongBan).toBe("Bộ phận Thi công");
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Xi măng PC40", quyCach: "50kg/bao", dvt: "bao", soLuong: 50, mucDichSuDung: "Đổ móng" },
    ]);
    expect(payload?.requestCode).toBe("012345");
    expect(payload?.nguoiGuiUid).toBe("uid-abc");
  });

  it("vẫn gửi đề xuất KHÔNG có công trình (đề xuất phòng ban) — congTrinhChuoi rỗng", async () => {
    const req = baseRequest({
      id: "req-2",
      code: "099887",
      fieldsSnapshot: [deptField, detailField],
      values: {
        f_bp: "Phòng Kế toán Tài chính",
        f_ct: [["Máy in Canon", "", "cái", "1", ""]],
      },
    });

    const payload = await trichXuatPayloadThuMua(req);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBeUndefined();
    expect(payload?.phongBan).toBe("Phòng Kế toán Tài chính");
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Máy in Canon", quyCach: undefined, dvt: "cái", soLuong: 1, mucDichSuDung: undefined },
    ]);
  });

  it("trả null khi thiếu field 'Chọn bộ phận'", async () => {
    const req = baseRequest({ fieldsSnapshot: [detailField], values: { f_ct: [["A", "", "cai", "1", ""]] } });
    expect(await trichXuatPayloadThuMua(req)).toBeNull();
  });

  it("trả null khi chưa có mã đề xuất (code null, đề xuất chưa gửi chính thức)", async () => {
    const req = baseRequest({ code: null, fieldsSnapshot: [deptField, detailField], values: { f_bp: "X", f_ct: [] } });
    expect(await trichXuatPayloadThuMua(req)).toBeNull();
  });

  it("trả null khi bảng chi tiết rỗng (không dòng vật tư hợp lệ)", async () => {
    const req = baseRequest({
      fieldsSnapshot: [deptField, detailField],
      values: { f_bp: "Bộ phận Thi công", f_ct: [] },
    });
    expect(await trichXuatPayloadThuMua(req)).toBeNull();
  });
});

describe("retryThuMuaSyncNeuLoi", () => {
  const reqDaLoi = baseRequest({
    thuMuaSyncStatus: "failed",
    fieldsSnapshot: [deptField, detailField],
    values: { f_bp: "Bộ phận Thi công", f_ct: [["Xi măng", "", "bao", "1", ""]] },
    history: [{ at: "2026-08-20T10:00:00.000Z", actor: "Hệ thống", action: "Đồng bộ App Thu mua thất bại" }],
  });

  it("không làm gì nếu status khác 'approved' — không gọi fetch, không ghi Firestore", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    updateMock.mockClear();

    await retryThuMuaSyncNeuLoi({ ...reqDaLoi, status: "pending" as RequestInstance["status"] });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("không làm gì nếu thuMuaSyncStatus khác 'failed' (đã đồng bộ xong, hoặc chưa từng thử)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    updateMock.mockClear();

    await retryThuMuaSyncNeuLoi({ ...reqDaLoi, thuMuaSyncStatus: "synced" });
    await retryThuMuaSyncNeuLoi({ ...reqDaLoi, thuMuaSyncStatus: undefined });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("thử lại thành công thì ghi thuMuaSyncStatus='synced' + thêm dòng lịch sử", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, trangThai: "da_tao", maDeNghi: "260001-HPCS-PR-001" }),
      }),
    );
    updateMock.mockClear();
    process.env.THUMUA_API_URL = "https://thumua.hpcore.vn";

    await retryThuMuaSyncNeuLoi(reqDaLoi);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const patch = updateMock.mock.calls[0][0];
    expect(patch.thuMuaSyncStatus).toBe("synced");
    expect(patch.history).toHaveLength(2);
    expect(patch.history[1].action).toContain("tự thử lại");
    vi.unstubAllGlobals();
  });

  it("thử lại vẫn thất bại thì giữ nguyên thuMuaSyncStatus='failed', vẫn ghi thêm lịch sử (không throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => { throw new SyntaxError("Unexpected token '<'"); } }),
    );
    updateMock.mockClear();
    process.env.THUMUA_API_URL = "https://thumua.hpcore.vn";

    await expect(retryThuMuaSyncNeuLoi(reqDaLoi)).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const patch = updateMock.mock.calls[0][0];
    expect(patch.thuMuaSyncStatus).toBe("failed");
    vi.unstubAllGlobals();
  });
});
