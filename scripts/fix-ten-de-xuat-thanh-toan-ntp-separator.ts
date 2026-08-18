import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "../lib/firebase/admin";

/**
 * Fix 1 lần: mẫu "Tên đề xuất" của nhóm "3. Thanh toán NTP" (groupId:
 * 8z2Vw1LcDVSlTrGiMJZY) bị thiếu dấu "-" giữa các trường (khác nhóm
 * "2. Phiếu đề nghị" cấu hình qua scripts/configure-computed-ten-de-xuat.ts,
 * nơi đã có sẵn quy ước "${a}-${b}") — Sếp phát hiện qua ảnh chụp màn hình
 * thật (17/08/2026), người nhập liệu phải tự gõ tay "-" vào cuối từng ô để
 * chữa cháy. Chỉ sửa MẪU cho đề xuất MỚI từ giờ — CỐ Ý không đụng vào field
 * value của các đề xuất đã nộp trước đây (Sếp xác nhận chỉ sửa từ giờ trở
 * đi, không dọn dữ liệu cũ).
 *
 * Trước: "${so_hop_dong_cdt}${ten_cong_trinh}${ten_ncc}${so_hop_dong_ncc}${so_tien}"
 * Sau:   "${so_hop_dong_cdt}-${ten_cong_trinh}-${ten_ncc}-${so_hop_dong_ncc}-${so_tien}"
 *
 * Chạy (BẮT BUỘC set NODE_OPTIONS — lib/firebase/admin.ts import "server-only"):
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/fix-ten-de-xuat-thanh-toan-ntp-separator.ts --dry-run
 *
 * Dry-run chỉ log, không ghi. Bỏ `--dry-run` để ghi thật, script tự đọc lại
 * Firestore sau khi ghi để xác nhận (không tin message thành công suông).
 */

const DRY_RUN = process.argv.includes("--dry-run");
const GROUP_ID = "8z2Vw1LcDVSlTrGiMJZY";
const FIELD_CODE = "ten_de_xuat";
const OLD_TEMPLATE = "${so_hop_dong_cdt}${ten_cong_trinh}${ten_ncc}${so_hop_dong_ncc}${so_tien}";
const NEW_TEMPLATE = "${so_hop_dong_cdt}-${ten_cong_trinh}-${ten_ncc}-${so_hop_dong_ncc}-${so_tien}";

type FieldDoc = { id: string; name: string; code?: string; computedFrom?: { branches: { template: string }[] } };

async function run() {
  console.log(DRY_RUN ? "=== DRY RUN — chỉ log, không ghi Firestore ===" : "=== CHẠY THẬT — sẽ ghi Firestore ===");

  const ref = adminDb.collection("groups").doc(GROUP_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Không tìm thấy group ${GROUP_ID}`);

  const data = snap.data()!;
  const fields = (data.fields ?? []) as FieldDoc[];
  console.log(`Nhóm: "${data.name}" — ${fields.length} field`);

  const target = fields.find((f) => f.code === FIELD_CODE);
  if (!target) throw new Error(`Không tìm thấy field code "${FIELD_CODE}" trong nhóm`);
  const currentTemplate = target.computedFrom?.branches?.[0]?.template;
  console.log(`Field mục tiêu: "${target.name}" (id: ${target.id})`);
  console.log(`Mẫu hiện tại: ${JSON.stringify(currentTemplate)}`);

  if (currentTemplate !== OLD_TEMPLATE) {
    throw new Error(
      `Mẫu hiện tại KHÔNG khớp giá trị dự kiến (có thể đã bị ai đó sửa từ lúc kiểm tra) — dừng lại, không ghi đè nhầm. Mẫu thấy được: ${JSON.stringify(currentTemplate)}`,
    );
  }

  const nextFields = fields.map((f) =>
    f.code === FIELD_CODE
      ? { ...f, computedFrom: { ...f.computedFrom, branches: [{ ...f.computedFrom!.branches[0], template: NEW_TEMPLATE }] } }
      : f,
  );

  if (DRY_RUN) {
    console.log(`[dry-run] Sẽ đổi mẫu thành: ${JSON.stringify(NEW_TEMPLATE)}`);
    return;
  }

  await ref.update({ fields: nextFields });
  console.log("Đã ghi. Đọc lại Firestore để xác nhận...");

  const verifySnap = await ref.get();
  const verifyFields = (verifySnap.data()!.fields ?? []) as FieldDoc[];
  const verifyTarget = verifyFields.find((f) => f.code === FIELD_CODE);
  const verifyTemplate = verifyTarget?.computedFrom?.branches?.[0]?.template;
  if (verifyTemplate !== NEW_TEMPLATE) throw new Error(`XÁC NHẬN THẤT BẠI: đọc lại ra mẫu khác dự kiến: ${JSON.stringify(verifyTemplate)}`);
  console.log(`XÁC NHẬN OK: mẫu mới = ${JSON.stringify(verifyTemplate)}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("LỖI:", err);
    process.exit(1);
  });
