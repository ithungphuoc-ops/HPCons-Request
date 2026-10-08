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
// Dòng lịch sử "tự thử lại" phải NỐI bằng arrayUnion (06/10/2026), không ghi
// đè cả mảng từ bản đọc trước khi gọi mạng — giả FieldValue để kiểm.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }) },
}));
// Giữ chỗ lượt thử lại (lib/sync-retry-guard.ts, 08/10/2026) chạy trong transaction —
// `retryAtStore` giả mốc `thuMuaRetryAt` đang lưu trên Firestore.
const retryAtStore: { value: string | undefined } = { value: undefined };
const txUpdateMock = vi.fn((_ref: unknown, data: Record<string, string>) => {
  retryAtStore.value = data.thuMuaRetryAt;
});
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({ doc: () => ({ update: updateMock }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: async () => ({ exists: true, get: () => retryAtStore.value }), update: txUpdateMock }),
  },
}));

const {
  trichXuatPayloadThuMua,
  retryThuMuaSyncNeuLoi,
  layNguoiTheoDoiGuiSangThuMua,
  layLoaiDeNghiGuiSangThuMua,
  xacDinhLoaiDeNghi,
} = await import("./thumua-sync");

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
    retryAtStore.value = undefined;
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
    expect(Array.isArray(patch.history)).toBe(false);
    expect(patch.history.__arrayUnion).toHaveLength(1);
    expect(patch.history.__arrayUnion[0].action).toContain("tự thử lại");
    vi.unstubAllGlobals();
  });

  it("thử lại vẫn thất bại (lỗi khác lần trước) → không ghi lại trạng thái 'failed' y cũ, vẫn nối lịch sử (không throw)", async () => {
    retryAtStore.value = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => { throw new SyntaxError("Unexpected token '<'"); } }),
    );
    updateMock.mockClear();
    process.env.THUMUA_API_URL = "https://thumua.hpcore.vn";

    await expect(retryThuMuaSyncNeuLoi(reqDaLoi)).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const patch = updateMock.mock.calls[0][0];
    expect("thuMuaSyncStatus" in patch).toBe(false);
    expect(patch.history.__arrayUnion).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("08/10/2026: kết quả y hệt dòng gần nhất của kênh Thu mua → không ghi gì thêm", async () => {
    retryAtStore.value = undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Kho bận" }) }));
    updateMock.mockClear();
    process.env.THUMUA_API_URL = "https://thumua.hpcore.vn";
    const daCoDongTrung = {
      ...reqDaLoi,
      history: [
        ...reqDaLoi.history,
        { at: "2026-10-07T10:00:00.000Z", actor: "Hệ thống", action: "Đồng bộ App Thu mua thất bại (tự thử lại)", note: "Kho bận" },
      ],
    };

    await retryThuMuaSyncNeuLoi(daCoDongTrung);

    expect(updateMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("08/10/2026: vừa thử lại chưa đủ 30 phút → không gọi Thu mua, không ghi", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    updateMock.mockClear();
    txUpdateMock.mockClear();
    const vuaThu = new Date(Date.now() - 5 * 60_000).toISOString();

    // Bản đọc đã có mốc gần → dừng ngay, không cả transaction.
    await retryThuMuaSyncNeuLoi({ ...reqDaLoi, thuMuaRetryAt: vuaThu });
    // Bản đọc cũ (chưa có mốc) nhưng tab khác vừa giữ chỗ → transaction chặn.
    retryAtStore.value = vuaThu;
    await retryThuMuaSyncNeuLoi(reqDaLoi);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(txUpdateMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("layNguoiTheoDoiGuiSangThuMua", () => {
  it("giữ đúng ba trường Thu mua cần, bỏ phần thừa", () => {
    const ra = layNguoiTheoDoiGuiSangThuMua([
      { id: "u1", name: "Đoàn Thu Thùy", username: "thuy.dt", avatarInitial: "Đ", title: "NV" },
    ]);
    expect(ra).toEqual([{ id: "u1", name: "Đoàn Thu Thùy", username: "thuy.dt" }]);
  });

  it("bỏ NHÓM — id của nhóm không phải uid người, gửi sang là bày ra một dòng không ai nhận được thông báo", () => {
    const ra = layNguoiTheoDoiGuiSangThuMua([
      { id: "g1", name: "Phòng Thu mua", username: "pth", kind: "group" },
      { id: "u1", name: "Trà Quế", username: "que.ptt" },
    ]);
    expect(ra.map((x) => x.id)).toEqual(["u1"]);
  });

  it("bỏ phần tử thiếu id — uid là thứ duy nhất có tác dụng thật bên Thu mua", () => {
    const ra = layNguoiTheoDoiGuiSangThuMua([
      { name: "Không có uid", username: "x" },
      { id: "   ", name: "id toàn khoảng trắng", username: "y" },
      { id: "u1", name: "Hợp lệ", username: "z" },
    ]);
    expect(ra.map((x) => x.id)).toEqual(["u1"]);
  });

  it("bỏ trùng theo id, giữ người đầu — hai dòng y hệt thì gỡ một phát mất cả hai", () => {
    const ra = layNguoiTheoDoiGuiSangThuMua([
      { id: "u1", name: "Lần một", username: "a" },
      { id: "u1", name: "Lần hai", username: "b" },
    ]);
    expect(ra).toHaveLength(1);
    expect(ra[0].name).toBe("Lần một");
  });

  it("rác vào thì mảng rỗng ra, KHÔNG ném lỗi — dữ liệu lạ chỉ được làm mất người theo dõi, không được làm hỏng cả lượt đồng bộ", () => {
    expect(layNguoiTheoDoiGuiSangThuMua(null)).toEqual([]);
    expect(layNguoiTheoDoiGuiSangThuMua(undefined)).toEqual([]);
    expect(layNguoiTheoDoiGuiSangThuMua("chuỗi lạ")).toEqual([]);
    expect(layNguoiTheoDoiGuiSangThuMua([null, 42, ["mảng lồng"], {}])).toEqual([]);
  });

  it("cắt khoảng trắng thừa quanh id và tên", () => {
    const ra = layNguoiTheoDoiGuiSangThuMua([{ id: " u1 ", name: " Tên  ", username: " nick " }]);
    expect(ra[0]).toEqual({ id: "u1", name: "Tên", username: "nick" });
  });
});

describe("xacDinhLoaiDeNghi — L02 luôn gửi loại đề nghị (03/10/2026)", () => {
  const oLoai = { id: "f_lc", options: ["Đề nghị công trình", "Đề nghị phòng ban"] };
  it("người dùng chọn rõ thì theo lựa chọn, kể cả khi có mã hợp đồng", () => {
    expect(xacDinhLoaiDeNghi([oLoai], { f_lc: "Đề nghị phòng ban" }, "30/2025/HĐXD")).toBe("phong_ban");
  });
  it("không có ô / ô trống → suy theo mã hợp đồng như Thu mua vẫn làm", () => {
    expect(xacDinhLoaiDeNghi([], {}, "30/2025/HĐXD - UNICE")).toBe("cong_trinh");
    expect(xacDinhLoaiDeNghi([], {}, undefined)).toBe("phong_ban");
    expect(xacDinhLoaiDeNghi([oLoai], { f_lc: "  " }, "")).toBe("phong_ban");
  });
  it("chọn lựa chọn lạ / mâu thuẫn → null (không đoán, để báo lỗi)", () => {
    const oLa = { id: "f_lc", options: ["Đề nghị công trình", "Đề nghị phòng ban", "Khác"] };
    expect(xacDinhLoaiDeNghi([oLa], { f_lc: "Khác" }, "30/2025/HĐXD")).toBeNull();
  });
  it("payload gửi Thu mua luôn kèm loại đề nghị", async () => {
    const req = baseRequest({
      fieldsSnapshot: [deptField, detailField],
      values: { f_bp: "Phòng Kế toán", f_ct: [["Máy in", "", "cái", "1", ""]] },
    });
    expect((await trichXuatPayloadThuMua(req))?.loaiDeNghi).toBe("phong_ban");
  });
});

describe("layLoaiDeNghiGuiSangThuMua", () => {
  /* Nhãn lấy đúng như biểu mẫu thật; mã trường cố ý là UUID khác nhau ở mỗi ca để chứng minh
     hàm KHÔNG dựa vào mã. Phía Thu mua đã đo ba mã khác nhau cho cùng một ô. */
  const oLuaChon = (id: string) => ({
    id,
    options: ["Đề nghị công trình", "Đề nghị phòng ban"],
  });

  it("đọc được 'Đề nghị công trình'", () => {
    expect(
      layLoaiDeNghiGuiSangThuMua([oLuaChon("e08076bf")], { e08076bf: "Đề nghị công trình" }),
    ).toBe("cong_trinh");
  });

  it("đọc được 'Đề nghị phòng ban'", () => {
    expect(
      layLoaiDeNghiGuiSangThuMua([oLuaChon("12cb9ca6")], { "12cb9ca6": "Đề nghị phòng ban" }),
    ).toBe("phong_ban");
  });

  it("tìm ô theo options, KHÔNG theo mã trường — mã đổi theo từng đời biểu mẫu", () => {
    const fields = [
      { id: "khac-1", options: ["Gấp", "Bình thường"] },
      oLuaChon("79590aee"),
    ];
    expect(layLoaiDeNghiGuiSangThuMua(fields, { "79590aee": "Đề nghị phòng ban" })).toBe(
      "phong_ban",
    );
  });

  it("bỏ trống → undefined, để Thu mua rơi về phép suy dự phòng của họ", () => {
    expect(layLoaiDeNghiGuiSangThuMua([oLuaChon("a")], { a: "" })).toBeUndefined();
    expect(layLoaiDeNghiGuiSangThuMua([oLuaChon("a")], {})).toBeUndefined();
  });

  it("biểu mẫu không có ô đó → undefined, không đoán bừa", () => {
    expect(
      layLoaiDeNghiGuiSangThuMua([{ id: "x", options: ["Gấp", "Bình thường"] }], { x: "Gấp" }),
    ).toBeUndefined();
  });

  it("chuỗi chứa CẢ HAI nhãn là ca mập mờ → undefined", () => {
    expect(
      layLoaiDeNghiGuiSangThuMua([oLuaChon("a")], { a: "Đề nghị công trình / Đề nghị phòng ban" }),
    ).toBeUndefined();
  });

  it("không phân biệt hoa thường và dấu cách thừa", () => {
    expect(layLoaiDeNghiGuiSangThuMua([oLuaChon("a")], { a: "  ĐỀ NGHỊ  CÔNG TRÌNH  " })).toBe(
      "cong_trinh",
    );
  });

  /* ── Hai ca CodeRabbit chỉ ra ở PR #39. Cả hai đều LÀM HỎNG bản đầu của hàm này. ── */

  it("lựa chọn thứ ba KHÔNG được suy thành công trình — 'Không phải công trình'", () => {
    const o = {
      id: "a",
      options: ["Đề nghị công trình", "Đề nghị phòng ban", "Không phải công trình"],
    };
    expect(layLoaiDeNghiGuiSangThuMua([o], { a: "Không phải công trình" })).toBeUndefined();
  });

  it("nhãn phủ định không bị nhận nhầm thành ô lựa chọn", () => {
    const o = {
      id: "a",
      options: ["Không phải đề nghị công trình", "Đề nghị công trình", "Đề nghị phòng ban"],
    };
    expect(layLoaiDeNghiGuiSangThuMua([o], { a: "Đề nghị công trình" })).toBe("cong_trinh");
  });

  it("ô bỏ trống đứng TRƯỚC không che mất lựa chọn ở ô sau", () => {
    const fields = [
      { id: "truoc", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
      { id: "sau", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
    ];
    expect(layLoaiDeNghiGuiSangThuMua(fields, { truoc: "", sau: "Đề nghị phòng ban" })).toBe(
      "phong_ban",
    );
  });

  it("hai ô chọn khác nhau = mâu thuẫn → undefined, không phân xử bằng thứ tự", () => {
    const fields = [
      { id: "mot", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
      { id: "hai", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
    ];
    expect(
      layLoaiDeNghiGuiSangThuMua(fields, {
        mot: "Đề nghị công trình",
        hai: "Đề nghị phòng ban",
      }),
    ).toBeUndefined();
  });

  it("hai ô cùng chọn một loại thì vẫn ra loại đó", () => {
    const fields = [
      { id: "mot", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
      { id: "hai", options: ["Đề nghị công trình", "Đề nghị phòng ban"] },
    ];
    expect(
      layLoaiDeNghiGuiSangThuMua(fields, {
        mot: "Đề nghị công trình",
        hai: "Đề nghị công trình",
      }),
    ).toBe("cong_trinh");
  });
});

describe("ô bảng xuống dòng — gửi sang Thu mua gộp thành 1 dấu cách (07/10/2026)", () => {
  it("tenVatTu/quyCach/dvt/mucDichSuDung không còn ký tự xuống dòng, dữ liệu gốc giữ nguyên", async () => {
    const cells = ["Thép D10\nHòa Phát\r\n", "  Cây 11.7m \n\n mác CB300 ", "cây\n", "120", "Đổ móng\nnhà xưởng"];
    const req = baseRequest({
      fieldsSnapshot: [deptField, detailField],
      values: { f_bp: "Bộ phận Thi công", f_ct: [cells] },
    });
    const payload = await trichXuatPayloadThuMua(req);
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Thép D10 Hòa Phát", quyCach: "Cây 11.7m mác CB300", dvt: "cây", soLuong: 120, mucDichSuDung: "Đổ móng nhà xưởng" },
    ]);
    expect((req.values.f_ct as string[][])[0][0]).toBe("Thép D10\nHòa Phát\r\n");
  });

  it("ô chỉ có xuống dòng tính là trống → dòng bị loại như cũ", async () => {
    const req = baseRequest({
      fieldsSnapshot: [deptField, detailField],
      values: { f_bp: "Bộ phận Thi công", f_ct: [["\n\n", "", "cái", "1", ""]] },
    });
    expect(await trichXuatPayloadThuMua(req)).toBeNull();
  });
});
