import { describe, expect, it, vi } from "vitest";
import type { ProposalField, RequestInstance } from "./types";

// `lib/r2.ts` khai `import "server-only"` ở đầu file — chặn được import từ Client Component
// thật, nhưng cũng khiến file không tải được trong môi trường test `jsdom` (bị coi là phía
// client). Không test đường tải tệp đính kèm ở đây (không liên quan payload gửi Thu mua),
// nên giả (mock) hẳn module này để tránh chạm vào guard đó — cùng vấn đề sẽ gặp nếu ai đó
// test `qlkctr-sync.ts`, không phải lỗi riêng của file mới này.
vi.mock("@/lib/r2", () => ({ createSignedReadUrl: vi.fn() }));

const { trichXuatPayloadThuMua } = await import("./thumua-sync");

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
