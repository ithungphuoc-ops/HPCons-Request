import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "../lib/firebase/admin";

/**
 * Script 1 lần cho change `add-computed-field-values`: cấu hình `computedFrom`
 * cho field "Tên đề xuất" (code: ten_de_xuat) của nhóm "2. Phiếu đề nghị"
 * (groupId: MbSGRaYx0FGGsObPjk4f) theo đúng 2 nhánh Sếp chốt:
 *
 *   - Nhánh 1: NẾU "Lựa chọn đề nghị" = "Đề nghị công trình"
 *              THÌ Tên đề xuất = "${so_hop_dong}-${ten_cong_trinh}"  (vd "123-ctr1")
 *   - Nhánh 2: NẾU "Lựa chọn đề nghị" = "Đề nghị phòng ban"
 *              THÌ Tên đề xuất = "Đề nghị ${bo_phan}"                (vd "Đề nghị Phòng IT")
 *
 * Chạy (BẮT BUỘC set NODE_OPTIONS — lib/firebase/admin.ts import "server-only",
 * xem ghi chú chi tiết ở scripts/migrate-condition-rules.ts):
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/configure-computed-ten-de-xuat.ts --dry-run
 *
 * Dry-run chỉ log, không ghi. Bỏ `--dry-run` để ghi thật, script sẽ đọc lại
 * Firestore sau khi ghi để xác nhận (không tin message thành công suông).
 */

const DRY_RUN = process.argv.includes("--dry-run");
const GROUP_ID = "MbSGRaYx0FGGsObPjk4f";

const COMPUTED_FROM = {
  branches: [
    {
      condition: {
        conjunction: "all",
        rules: [{ fieldCode: "lua_chon_de_nghi", operator: "equals", value: "Đề nghị công trình" }],
      },
      template: "${so_hop_dong}-${ten_cong_trinh}",
    },
    {
      condition: {
        conjunction: "all",
        rules: [{ fieldCode: "lua_chon_de_nghi", operator: "equals", value: "Đề nghị phòng ban" }],
      },
      template: "Đề nghị ${bo_phan}",
    },
  ],
};

type FieldDoc = { id: string; name: string; code?: string; computedFrom?: unknown };

async function run() {
  console.log(DRY_RUN ? "=== DRY RUN — chỉ log, không ghi Firestore ===" : "=== CHẠY THẬT — sẽ ghi Firestore ===");

  const ref = adminDb.collection("groups").doc(GROUP_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Không tìm thấy group ${GROUP_ID}`);

  const data = snap.data()!;
  const fields = (data.fields ?? []) as FieldDoc[];
  console.log(`Nhóm: "${data.name}" — ${fields.length} field`);

  const target = fields.find((f) => f.code === "ten_de_xuat");
  if (!target) throw new Error(`Không tìm thấy field code "ten_de_xuat" trong nhóm`);
  console.log(`Field mục tiêu: "${target.name}" (id: ${target.id})`);
  if (target.computedFrom) {
    console.log("LƯU Ý: field đã có computedFrom sẵn — sẽ GHI ĐÈ:", JSON.stringify(target.computedFrom));
  }

  // Kiểm tra mọi mã field tham chiếu (điều kiện + mẫu chuỗi) có thật trong nhóm.
  const knownCodes = new Set(fields.map((f) => f.code).filter(Boolean));
  for (const need of ["lua_chon_de_nghi", "so_hop_dong", "ten_cong_trinh", "bo_phan"]) {
    if (!knownCodes.has(need)) throw new Error(`Field code "${need}" không tồn tại trong nhóm — dừng, không ghi.`);
  }
  console.log("Đã xác nhận đủ 4 field nguồn: lua_chon_de_nghi, so_hop_dong, ten_cong_trinh, bo_phan");

  const nextFields = fields.map((f) => (f.code === "ten_de_xuat" ? { ...f, computedFrom: COMPUTED_FROM } : f));

  if (DRY_RUN) {
    console.log("[dry-run] Sẽ ghi computedFrom:", JSON.stringify(COMPUTED_FROM, null, 2));
    return;
  }

  await ref.update({ fields: nextFields });
  console.log("Đã ghi. Đọc lại Firestore để xác nhận...");

  const verifySnap = await ref.get();
  const verifyFields = (verifySnap.data()!.fields ?? []) as FieldDoc[];
  const verifyTarget = verifyFields.find((f) => f.code === "ten_de_xuat");
  if (!verifyTarget?.computedFrom) throw new Error("XÁC NHẬN THẤT BẠI: đọc lại không thấy computedFrom!");
  const branches = (verifyTarget.computedFrom as typeof COMPUTED_FROM).branches;
  console.log(`XÁC NHẬN OK: field "${verifyTarget.name}" có computedFrom với ${branches.length} nhánh:`);
  for (const [i, b] of branches.entries()) {
    console.log(`  Nhánh ${i + 1}: khi ${JSON.stringify(b.condition?.rules)} → mẫu "${b.template}"`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("LỖI:", err);
    process.exit(1);
  });
