import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Đọc chéo app Công nợ (congno.hpcore.vn, project Firestore RIÊNG
 * "hpcons-congno") — xem openspec/changes/add-contract-code-lookup.
 * App Công nợ là 1 SPA thuần, không có server API nào; base-request-app đọc
 * THẲNG Firestore của họ bằng Admin SDK phía server, CHỈ ĐỌC (không có hàm
 * ghi nào trong file này) — dùng đúng mẫu đã có ở lib/hpcore.ts (đọc chéo
 * app tổng), chỉ khác project/biến môi trường.
 *
 * 🔴 CHỈ đọc collection "contracts" và CHỈ forward `code`/`group`/`name` ra
 * ngoài file này (xem app/api/groups/[id]/contract-code-suggestions/route.ts)
 * — dữ liệu tài chính (`totalAfterTax`, `customerName`, `work`...) của app
 * Công nợ KHÔNG được lộ ra bất kỳ đâu trong base-request-app.
 */

const APP_NAME = "congno";

function loadCred(): object {
  const raw = process.env.CONGNO_FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "Thiếu CONGNO_FIREBASE_SERVICE_ACCOUNT (service account project hpcons-congno).",
    );
  }
  return JSON.parse(raw);
}

function getCongNoApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  return initializeApp(
    { credential: cert(loadCred() as Parameters<typeof cert>[0]) },
    APP_NAME,
  );
}

const g = globalThis as unknown as { __congnoDb?: Firestore };

/** Firestore của app Công nợ — CHỈ ĐỌC (không export hàm ghi nào). */
export function getCongNoDb(): Firestore {
  return (g.__congnoDb ??= getFirestore(getCongNoApp()));
}

export interface ContractCodeSuggestion {
  code: string;
  project: string;
}

/**
 * Danh sách Số Hợp Đồng CĐT thật, CHỈ 2 field `code`+`project` — dùng chung
 * cho cả route gợi ý (client) và validate chặn gửi (server), tránh 2 nơi tự
 * đọc/tự map field khác nhau rồi lệch nhau.
 */
export async function loadContractCodeSuggestions(): Promise<ContractCodeSuggestion[]> {
  const snap = await getCongNoDb().collection("contracts").get();
  return snap.docs.map((d) => {
    const data = d.data();
    const project =
      typeof data.group === "string" && data.group.trim()
        ? data.group.trim()
        : typeof data.name === "string"
          ? data.name.trim()
          : "";
    return { code: String(data.code ?? "").trim(), project };
  }).filter((c) => c.code);
}
