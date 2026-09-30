import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { shortenCustomerName } from "./customer-name";

/**
 * Đọc chéo app Công nợ (congno.hpcore.vn, project Firestore RIÊNG
 * "hpcons-congno") — xem openspec/changes/add-contract-code-lookup.
 * App Công nợ là 1 SPA thuần, không có server API nào; base-request-app đọc
 * THẲNG Firestore của họ bằng Admin SDK phía server, CHỈ ĐỌC (không có hàm
 * ghi nào trong file này) — dùng đúng mẫu đã có ở lib/hpcore.ts (đọc chéo
 * app tổng), chỉ khác project/biến môi trường.
 *
 * 🔴 CHỈ đọc collection "contracts" và CHỈ forward `code`/`group`/`name`/`work`/
 * `customerName` ra ngoài file này (xem
 * lib/external-code-sources.ts và app/api/groups/[id]/external-code-suggestions/
 * route.ts) — `work` ("hạng mục") và `customerName` ("Tên CĐT", hiện ở cột
 * phụ trong dropdown gợi ý) được Sếp chốt cho lộ ra (26/09/2026) để người
 * làm đề nghị đối chiếu, tự phát hiện gõ nhầm Số Hợp Đồng CĐT. Dữ liệu TÀI
 * CHÍNH (`totalAfterTax`...) của app Công nợ vẫn KHÔNG được lộ ra bất kỳ đâu
 * trong base-request-app. Từ 30/09/2026 (change add-external-code-lookup-picker)
 * còn thêm nguồn "subcontractors" (Mã nhà thầu phụ) — xem hàm
 * `loadSubcontractorCodeSuggestions` bên dưới.
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
  /** "Tên CĐT" (Chủ Đầu Tư) — tên pháp nhân ĐẦY ĐỦ y nguyên trong Firestore
   * app Công nợ (vd "CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI"). KHÔNG
   * hiện trực tiếp field này ở dropdown gợi ý — dùng `customerNameShort`
   * bên dưới (Sếp chốt 26/09/2026: tên đầy đủ quá dài, khó đối chiếu
   * nhanh lúc đang gõ). Giữ lại field gốc phòng khi cần đối chiếu/debug. */
  customerName: string;
  /** "Tên CĐT" rút gọn — bỏ các từ pháp nhân/mô tả ngành nghề chung chung
   * (CÔNG TY, TNHH, CỔ PHẦN, CÔNG NGHIỆP, CHÍNH XÁC...) và hậu tố "VIỆT
   * NAM", giữ nguyên phần tên thương hiệu còn lại — xem `shortenCustomerName`.
   * Đây là giá trị hiện ở cột phụ dropdown gợi ý. */
  customerNameShort: string;
}

/**
 * Danh sách Số Hợp Đồng CĐT thật, CHỈ 4 field `code`+`project`+`work`+
 * `customerName` — dùng chung cho cả route gợi ý (client) và validate chặn
 * gửi (server), tránh 2 nơi tự đọc/tự map field khác nhau rồi lệch nhau.
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
    const customerName = typeof data.customerName === "string" ? data.customerName.trim() : "";
    const customerNameShort = customerName ? shortenCustomerName(customerName) : "";
    return { code: String(data.code ?? "").trim(), project, work, customerName, customerNameShort };
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

/**
 * "Mã nhà thầu phụ" — collection RIÊNG `subcontractors` (khác `contracts`,
 * cùng project "hpcons-congno") — xem openspec/changes/add-external-code-lookup-picker.
 *
 * 🔴 CHỈ đọc và forward đúng 4 field `ma`/`mst`/`ten`/`diaChi` — collection
 * này còn có `nguon`, `hopDong` (mảng hợp đồng gắn với nhà thầu), `createdAt`,
 * `updatedAt`, `updatedBy` KHÔNG được lộ ra bất kỳ đâu ngoài file này.
 *
 * Nhà thầu do hệ thống Công nợ TỰ THÊM lúc "Ký kết hợp đồng" thường chỉ có
 * `mst`, không có `ma` (xem `ghiNhanNhaThauKhiKyKet` trong HPCons-Congno/
 * lib/subcontractors.ts) — filter bỏ bản ghi thiếu CẢ 2 field (không có gì
 * để khớp), còn thiếu 1 trong 2 thì vẫn giữ.
 */
export interface SubcontractorCodeSuggestion {
  ma: string;
  mst: string;
  ten: string;
  diaChi: string;
}

async function loadSubcontractorCodeSuggestionsUncached(): Promise<SubcontractorCodeSuggestion[]> {
  const snap = await getCongNoDb().collection("subcontractors").get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        ma: typeof data.ma === "string" ? data.ma.trim() : "",
        mst: typeof data.mst === "string" ? data.mst.trim() : "",
        ten: typeof data.ten === "string" ? data.ten.trim() : "",
        diaChi: typeof data.diaChi === "string" ? data.diaChi.trim() : "",
      };
    })
    .filter((s) => s.ma || s.mst);
}

/** Cache 5 phút — cùng lý do/thời hạn với `loadContractCodeSuggestions` (dùng
 * chung cho cả gợi ý lẫn validate, xem lib/external-code-sources.ts). */
export const loadSubcontractorCodeSuggestions = unstable_cache(
  loadSubcontractorCodeSuggestionsUncached,
  ["subcontractor-code-suggestions"],
  { revalidate: 300 },
);
