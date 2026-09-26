import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";

/**
 * Đọc chéo app Công nợ (congno.hpcore.vn, project Firestore RIÊNG
 * "hpcons-congno") — xem openspec/changes/add-contract-code-lookup.
 * App Công nợ là 1 SPA thuần, không có server API nào; base-request-app đọc
 * THẲNG Firestore của họ bằng Admin SDK phía server, CHỈ ĐỌC (không có hàm
 * ghi nào trong file này) — dùng đúng mẫu đã có ở lib/hpcore.ts (đọc chéo
 * app tổng), chỉ khác project/biến môi trường.
 *
 * 🔴 CHỈ đọc collection "contracts" và CHỈ forward `code`/`group`/`name`/`work`
 * ra ngoài file này (xem app/api/groups/[id]/contract-code-suggestions/route.ts)
 * — `work` ("hạng mục", mô tả công việc) được Sếp chốt cho lộ ra để người làm
 * đề nghị đối chiếu tự phát hiện gõ nhầm Số Hợp Đồng CĐT (26/09/2026). Dữ liệu
 * TÀI CHÍNH (`totalAfterTax`, `customerName`...) của app Công nợ vẫn KHÔNG
 * được lộ ra bất kỳ đâu trong base-request-app.
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
  /** "Hạng mục" — mô tả công việc của hợp đồng, để người làm đề nghị đối
   * chiếu tự phát hiện gõ nhầm Số Hợp Đồng CĐT (không phải dữ liệu tài
   * chính). Rỗng nếu app Công nợ chưa điền field `work` cho hợp đồng đó. */
  work: string;
}

/**
 * Danh sách Số Hợp Đồng CĐT thật, CHỈ 3 field `code`+`project`+`work` — dùng
 * chung cho cả route gợi ý (client) và validate chặn gửi (server), tránh 2
 * nơi tự đọc/tự map field khác nhau rồi lệch nhau.
 */
async function loadContractCodeSuggestionsUncached(): Promise<ContractCodeSuggestion[]> {
  const snap = await getCongNoDb().collection("contracts").get();
  return snap.docs.map((d) => {
    const data = d.data();
    const project =
      typeof data.group === "string" && data.group.trim()
        ? data.group.trim()
        : typeof data.name === "string"
          ? data.name.trim()
          : "";
    const work = typeof data.work === "string" ? data.work.trim() : "";
    return { code: String(data.code ?? "").trim(), project, work };
  }).filter((c) => c.code);
}

/**
 * Cache 5 phút — dùng CHUNG cho cả route gợi ý (client gõ tìm) LẪN validate
 * chặn gửi (server, lúc gửi chính thức). Trước đó validate tự đọc thẳng
 * Firestore mỗi lần gửi đề xuất (không qua cache) — CodeRabbit PR #41 chỉ ra
 * đây là điểm tốn lượt đọc không cần thiết, trong khi route gợi ý đã cache
 * đúng dữ liệu này rồi. Chấp nhận độ trễ tối đa 5 phút giữa lúc thêm hợp đồng
 * mới ở app Công nợ và lúc gửi đề xuất thấy được mã đó — cùng đánh đổi đã
 * chấp nhận cho route gợi ý (xem design.md Decision #3).
 */
export const loadContractCodeSuggestions = unstable_cache(
  loadContractCodeSuggestionsUncached,
  ["contract-code-suggestions"],
  { revalidate: 300 },
);
