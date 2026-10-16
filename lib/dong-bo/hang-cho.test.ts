import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestInstance } from "@/lib/types";

/**
 * Hàng chờ đồng bộ — phần App EQUI (16/10/2026, "Liên kết mua hàng EQUI"). Firestore giả trong bộ nhớ,
 * không chạm Firestore / R2 / mạng thật.
 */

vi.mock("server-only", () => ({}));

const XOA = Symbol("delete");
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { delete: () => XOA, arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }) },
}));

type Doc = Record<string, unknown>;
const kho = new Map<string, Map<string, Doc>>();
const bang = (ten: string) => {
  if (!kho.has(ten)) kho.set(ten, new Map());
  return kho.get(ten)!;
};
let soTuDong = 0;

function apPatch(cu: Doc, patch: Doc): Doc {
  const moi = { ...cu };
  for (const [k, v] of Object.entries(patch)) {
    if (v === XOA) delete moi[k];
    else if (v && typeof v === "object" && "__arrayUnion" in v) {
      moi[k] = [...((moi[k] as unknown[]) ?? []), ...(v as { __arrayUnion: unknown[] }).__arrayUnion];
    } else moi[k] = v;
  }
  return moi;
}

function docRef(ten: string, id: string) {
  const ref = {
    id,
    get: async () => anh(ten, id),
    set: async (data: Doc) => void bang(ten).set(id, { ...data }),
    update: async (patch: Doc) => void bang(ten).set(id, apPatch(bang(ten).get(id) ?? {}, patch)),
  };
  return ref;
}
function anh(ten: string, id: string) {
  const data = bang(ten).get(id);
  return { id, exists: !!data, data: () => (data ? { ...data } : undefined), get: (k: string) => data?.[k], ref: docRef(ten, id) };
}
type Loc = { k: string; op: string; v: unknown };
function truyVan(ten: string, loc: Loc[] = []) {
  return {
    where: (k: string, op: string, v: unknown) => truyVan(ten, [...loc, { k, op, v }]),
    orderBy: () => truyVan(ten, loc),
    limit: () => truyVan(ten, loc),
    get: async () => ({
      docs: [...bang(ten).entries()]
        .filter(([, d]) => loc.every((l) => (l.op === "==" ? d[l.k] === l.v : (d[l.k] as number) <= (l.v as number))))
        .map(([id]) => anh(ten, id)),
    }),
  };
}

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: (ten: string) => ({
      doc: (id?: string) => docRef(ten, id ?? `tu-dong-${++soTuDong}`),
      ...truyVan(ten),
    }),
    batch: () => {
      const viec: (() => Promise<void>)[] = [];
      return {
        set: (ref: ReturnType<typeof docRef>, data: Doc) => void viec.push(() => ref.set(data)),
        update: (ref: ReturnType<typeof docRef>, patch: Doc) => void viec.push(() => ref.update(patch)),
        commit: async () => {
          for (const v of viec) await v();
        },
      };
    },
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        update: (ref: ReturnType<typeof docRef>, patch: Doc) => ref.update(patch),
      }),
  },
}));

vi.mock("@/lib/r2", () => ({ createSignedReadUrl: vi.fn(async (p: string) => `https://signed.example/${p}`) }));

const deXuat = new Map<string, RequestInstance>();
vi.mock("@/lib/server/requests", () => ({ loadRequest: vi.fn(async (id: string) => deXuat.get(id) ?? null) }));

const { taoViecDongBo, guiViec } = await import("./hang-cho");

function taoDeXuat(id: string, groupNameSnapshot: string, luaChon = "Đề nghị lô hàng SX"): RequestInstance {
  const r = {
    id,
    code: `0000${id}`,
    groupId: "g",
    groupNameSnapshot,
    fieldsSnapshot: [
      { id: "f_ten", code: "ten_de_xuat", name: "Tên đề xuất", dataType: "short_text", required: false, order: 1 },
      {
        id: "f_lc",
        code: "lua_chon_de_nghi",
        name: "Lựa chọn đề nghị",
        dataType: "single_choice",
        options: ["Đề nghị lô hàng SX", "Đề nghị phòng ban"],
        required: false,
        order: 2,
      },
      { id: "f_ct", code: "chi_tiet", name: "Chi tiết", dataType: "table", tableColumns: ["Tên hàng", "ĐVT", "Số lượng"], required: false, order: 3 },
    ],
    values: { f_ten: "Lô 10", f_lc: luaChon, f_ct: [["Thép", "cây", "3"]] },
    submittedBy: { uid: "u", email: "a@hpcons.com.vn", name: "A" },
    submittedAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved",
    deadlineAt: null,
    history: [],
    comments: [],
    deletedAt: null,
  } as unknown as RequestInstance;
  deXuat.set(id, r);
  bang("requests").set(id, { groupNameSnapshot, history: [] });
  return r;
}

const viecCua = (requestId: string): (Doc & { id: string })[] =>
  [...bang("hang_cho_dong_bo").entries()].filter(([, d]) => d.requestId === requestId).map(([id, d]) => ({ ...d, id }));

const ENV_GOC = { url: process.env.EQUI_API_URL, key: process.env.EQUI_API_KEY };
beforeEach(() => {
  kho.clear();
  deXuat.clear();
  process.env.EQUI_API_URL = "https://equi.example";
  process.env.EQUI_API_KEY = "khoa-equi";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ENV_GOC.url === undefined) delete process.env.EQUI_API_URL;
  else process.env.EQUI_API_URL = ENV_GOC.url;
  if (ENV_GOC.key === undefined) delete process.env.EQUI_API_KEY;
  else process.env.EQUI_API_KEY = ENV_GOC.key;
});

describe("taoViecDongBo — chọn app đích theo nhóm (16/10/2026)", () => {
  it("nhóm (EQUI) duyệt xong → việc cho App EQUI + Thu mua, KHÔNG có việc Kho", async () => {
    taoDeXuat("r1", "1.0. Phiếu đề nghị (EQUI)");
    const ids = await taoViecDongBo({ requestId: "r1", requestCode: "0000r1", loai: "duyet" });
    expect(ids).toEqual(["duyet-equi-r1", "duyet-thumua-r1"]);
    expect(viecCua("r1").map((v) => v.dich).sort()).toEqual(["equi", "thumua"]);
  });

  it("nhóm thường → Kho + Thu mua y như cũ", async () => {
    taoDeXuat("r2", "2. Phiếu đề nghị");
    expect(await taoViecDongBo({ requestId: "r2", requestCode: null, loai: "duyet" })).toEqual([
      "duyet-kho-r2",
      "duyet-thumua-r2",
    ]);
  });

  it("áp dụng cho mọi loại việc: điều chỉnh / thêm tệp / xoá / khôi phục của nhóm EQUI không bao giờ sang Kho", async () => {
    taoDeXuat("r3", "0. Đề xuất trực tiếp (EQUI)");
    for (const loai of ["dieu_chinh", "them_file", "xoa", "khoi_phuc"] as const) {
      await taoViecDongBo({ requestId: "r3", requestCode: null, loai });
    }
    const ds = viecCua("r3");
    expect(ds).toHaveLength(8);
    expect(ds.some((v) => v.dich === "kho")).toBe(false);
  });

  it("không tìm thấy đề xuất → như nhóm thường; truyền `dichs` thì dùng đúng `dichs`", async () => {
    expect(await taoViecDongBo({ requestId: "khong-co", requestCode: null, loai: "duyet" })).toEqual([
      "duyet-kho-khong-co",
      "duyet-thumua-khong-co",
    ]);
    taoDeXuat("r4", "1.0. Phiếu đề nghị (EQUI)");
    expect(await taoViecDongBo({ requestId: "r4", requestCode: null, loai: "duyet", dichs: ["thumua"] })).toEqual([
      "duyet-thumua-r4",
    ]);
  });

  it("xoá đề xuất EQUI → huỷ việc 'gửi đề nghị' App EQUI chưa tới nơi; khôi phục → gọi lại", async () => {
    taoDeXuat("r5", "1.0. Phiếu đề nghị (EQUI)");
    await taoViecDongBo({ requestId: "r5", requestCode: null, loai: "duyet" });
    await taoViecDongBo({ requestId: "r5", requestCode: null, loai: "xoa" });
    expect(bang("hang_cho_dong_bo").get("duyet-equi-r5")).toMatchObject({ trangThai: "huy", huyDoXoa: true });
    const ids = await taoViecDongBo({ requestId: "r5", requestCode: null, loai: "khoi_phuc" });
    expect(ids).toContain("duyet-equi-r5");
    expect(bang("hang_cho_dong_bo").get("duyet-equi-r5")).toMatchObject({ trangThai: "cho", huyDoXoa: false });
  });
});

describe("guiViec — đích App EQUI", () => {
  it("duyệt 'Đề nghị lô hàng SX' → gửi App EQUI, ghi 'Đã đồng bộ sang App EQUI' + equiSyncStatus=synced", async () => {
    taoDeXuat("r6", "1.0. Phiếu đề nghị (EQUI)");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, trangThai: "da_tao_de_nghi", deNghiId: "d1", maDeNghi: "DNEQ-01" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    await taoViecDongBo({ requestId: "r6", requestCode: "0000r6", loai: "duyet", dichs: ["equi"] });

    expect(await guiViec("duyet-equi-r6")).toBe("da_gui");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://equi.example/api/app-request/de-nghi-duyet");
    expect(fetchSpy.mock.calls[0][1].headers["x-api-key"]).toBe("khoa-equi");
    expect(bang("hang_cho_dong_bo").get("duyet-equi-r6")).toMatchObject({ trangThai: "da_gui", ketQua: "da_tao_de_nghi" });
    const rq = bang("requests").get("r6")!;
    expect(rq.equiSyncStatus).toBe("synced");
    expect(rq.qlkCtrSyncStatus).toBeUndefined();
    expect(rq.history).toEqual([
      expect.objectContaining({ actor: "Hệ thống", action: "Đã đồng bộ sang App EQUI", note: "Mã đề nghị: DNEQ-01" }),
    ]);
  });

  it("'da_ton_tai' (EQUI đã nhận từ trước) cũng là thành công", async () => {
    taoDeXuat("r7", "1.0. Phiếu đề nghị (EQUI)");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, trangThai: "da_ton_tai", maDeNghi: "DNEQ-02" }) }),
    );
    await taoViecDongBo({ requestId: "r7", requestCode: null, loai: "duyet", dichs: ["equi"] });
    expect(await guiViec("duyet-equi-r7")).toBe("da_gui");
  });

  it("phiếu 'Đề nghị phòng ban' → huỷ êm (không phải lỗi), không gọi mạng", async () => {
    taoDeXuat("r8", "1.0. Phiếu đề nghị (EQUI)", "Đề nghị phòng ban");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await taoViecDongBo({ requestId: "r8", requestCode: null, loai: "duyet", dichs: ["equi"] });
    expect(await guiViec("duyet-equi-r8")).toBe("huy");
    expect(String(bang("hang_cho_dong_bo").get("duyet-equi-r8")?.loi)).toContain("Không thuộc diện gửi App EQUI");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("thiếu EQUI_API_URL → dừng ngay (lỗi vĩnh viễn), đề xuất ghi equiSyncStatus=dung + cảnh báo", async () => {
    delete process.env.EQUI_API_URL;
    taoDeXuat("r9", "1.0. Phiếu đề nghị (EQUI)");
    await taoViecDongBo({ requestId: "r9", requestCode: null, loai: "duyet", dichs: ["equi"] });
    expect(await guiViec("duyet-equi-r9")).toBe("dung");
    expect(String(bang("hang_cho_dong_bo").get("duyet-equi-r9")?.loi)).toContain("Chưa cấu hình EQUI_API_URL");
    const rq = bang("requests").get("r9")!;
    expect(rq.equiSyncStatus).toBe("dung");
    expect((rq.history as { action: string }[])[0].action).toContain("App EQUI");
  });

  it("trạng thái lạ dù ok:true → KHÔNG coi là tới nơi, hẹn gửi lại", async () => {
    taoDeXuat("r10", "1.0. Phiếu đề nghị (EQUI)");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, trangThai: "la" }) }));
    await taoViecDongBo({ requestId: "r10", requestCode: null, loai: "duyet", dichs: ["equi"] });
    expect(await guiViec("duyet-equi-r10")).toBe("cho");
  });

  it("sự kiện sau duyệt → gửi {EQUI_API_URL}/api/app-request/cap-nhat-de-nghi với khoá EQUI", async () => {
    taoDeXuat("r11", "1.0. Phiếu đề nghị (EQUI)");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, trangThai: "da_ghi_dieu_chinh" }) });
    vi.stubGlobal("fetch", fetchSpy);
    const [id] = await taoViecDongBo({ requestId: "r11", requestCode: "0000r11", loai: "dieu_chinh", noiDung: "Đổi SL", dichs: ["equi"] });
    expect(await guiViec(id)).toBe("da_gui");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://equi.example/api/app-request/cap-nhat-de-nghi");
    expect(fetchSpy.mock.calls[0][1].headers["x-api-key"]).toBe("khoa-equi");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ suKienId: id, requestId: "r11", loai: "dieu_chinh", noiDung: "Đổi SL" });
    const rq = bang("requests").get("r11")!;
    expect((rq.history as { action: string }[])[0].action).toBe("Đã báo App EQUI: Điều chỉnh sau duyệt");
  });
});
