import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "../lib/firebase/admin";

/**
 * Migration 1 lần cho change `extend-condition-rules`: đổi `ConditionRule`
 * đơn cũ (shape `{ fieldCode, operator, value }`) thành `ConditionGroup` mới
 * (`{ conjunction: "all", rules: [ruleCũ] }`) ở cả 3 nơi lưu điều kiện của
 * mỗi `ProposalGroup`: `fields[].visibleWhen`, `approverSteps[].condition`,
 * `followersConditional[].condition`.
 *
 * Kết quả về mặt hành vi GIỐNG HỆT rule cũ (1 rule/conjunction "all" tương
 * đương y hệt rule đơn) — migration chỉ đổi HÌNH DẠNG dữ liệu để code mới
 * (chỉ đọc ConditionGroup) đọc được, không cần admin cấu hình lại.
 *
 * Chạy (LƯU Ý bắt buộc set NODE_OPTIONS như dưới — `lib/firebase/admin.ts`
 * import "server-only", package này dùng conditional exports "react-server"
 * để trả về bản no-op; Next.js tự set điều kiện đó khi build, nhưng tsx/node
 * chạy standalone thì KHÔNG, nên phải tự truyền vào, nếu không sẽ throw
 * "This module cannot be imported from a Client Component module"):
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/migrate-condition-rules.ts --dry-run
 *
 * Dry-run chỉ log, không ghi. Xong rồi bỏ `--dry-run` để ghi thật. BẮT BUỘC
 * backup dữ liệu Firestore (`groups` collection) trước khi chạy thật trên
 * production — xem design.md phần Migration Plan của change này.
 */

const DRY_RUN = process.argv.includes("--dry-run");

/** Rule đơn cũ có `fieldCode` nhưng KHÔNG có `rules` — đây là cách phát hiện
 * dữ liệu chưa migrate (ConditionGroup mới luôn có `rules`, không có `fieldCode`
 * ở cấp ngoài cùng). */
function isLegacyRule(value: unknown): value is { fieldCode: string; operator: string; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "fieldCode" in value &&
    !("rules" in value)
  );
}

function toConditionGroup(legacy: { fieldCode: string; operator: string; value: string }) {
  return { conjunction: "all" as const, rules: [legacy] };
}

async function migrate() {
  console.log(DRY_RUN ? "=== DRY RUN — chỉ log, không ghi Firestore ===" : "=== CHẠY THẬT — sẽ ghi Firestore ===");

  const snapshot = await adminDb.collection("groups").get();
  let groupsChanged = 0;
  let fieldsChanged = 0;
  let stepsChanged = 0;
  let followersChanged = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let changed = false;

    const fields = Array.isArray(data.fields) ? [...data.fields] : [];
    const nextFields = fields.map((f: Record<string, unknown>) => {
      if (isLegacyRule(f.visibleWhen)) {
        changed = true;
        fieldsChanged += 1;
        return { ...f, visibleWhen: toConditionGroup(f.visibleWhen) };
      }
      return f;
    });

    const approverSteps = Array.isArray(data.approverSteps) ? [...data.approverSteps] : [];
    const nextApproverSteps = approverSteps.map((s: Record<string, unknown>) => {
      if (isLegacyRule(s.condition)) {
        changed = true;
        stepsChanged += 1;
        return { ...s, condition: toConditionGroup(s.condition) };
      }
      return s;
    });

    const followersConditional = Array.isArray(data.followersConditional) ? [...data.followersConditional] : [];
    const nextFollowersConditional = followersConditional.map((item: Record<string, unknown>) => {
      if (isLegacyRule(item.condition)) {
        changed = true;
        followersChanged += 1;
        return { ...item, condition: toConditionGroup(item.condition) };
      }
      return item;
    });

    if (!changed) continue;

    groupsChanged += 1;
    console.log(`[nhóm] ${data.name ?? doc.id} (${doc.id}) — có thay đổi`);

    if (!DRY_RUN) {
      await doc.ref.update({
        fields: nextFields,
        approverSteps: nextApproverSteps,
        followersConditional: nextFollowersConditional,
      });
    }
  }

  console.log("\n=== Tổng kết ===");
  console.log(`Nhóm bị ảnh hưởng: ${groupsChanged}/${snapshot.size}`);
  console.log(`Field (visibleWhen) đã bọc: ${fieldsChanged}`);
  console.log(`Bước duyệt (condition) đã bọc: ${stepsChanged}`);
  console.log(`Người theo dõi điều kiện (condition) đã bọc: ${followersChanged}`);
  if (DRY_RUN) {
    console.log("\nĐây là dry-run — CHƯA ghi gì vào Firestore. Chạy lại không có --dry-run để ghi thật.");
  } else {
    console.log("\nĐã ghi xong vào Firestore.");
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
