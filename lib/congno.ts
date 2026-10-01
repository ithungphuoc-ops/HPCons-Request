import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";
import { shortenCustomerName } from "./customer-name";
import { ntpVietTat } from "./ntp-viet-tat";

/**
 * Đọc/ghi chéo app Công nợ (congno.hpcore.vn, project Firestore RIÊNG
 * "hpcons-congno") — xem openspec/changes/add-contract-code-lookup. App Công
 * nợ là 1 SPA thuần, không có server API nào đáng tin cậy để gọi (route
 * POST /api/subcontractors của họ không tự validate gì, lại đòi 1 loại ID
 * token riêng của project đó — xem Quyết định 4, change
 * add-create-subcontractor-from-request); base-request-app đọc/ghi THẲNG
 * Firestore của họ bằng Admin SDK phía server — dùng đúng mẫu đã có ở
 * lib/hpcore.ts (đọc chéo app tổng), chỉ khác project/biến môi trường.
 *
 * Từ 01/10/2026 (Sếp chốt) file này có THÊM đúng 1 hàm GHI
 * (`createSubcontractorInCongNo`, dưới cùng file) — lần đầu base-request-app
 * ghi qua app khác, trước giờ chỉ đọc. Hàm ghi CHỈ tạo mới 1 document trong
 * collection "subcontractors", KHÔNG đụng field `nguon` cũ (enum
 * "goc"|"xetduyet", Công nợ dùng để hiện badge/lọc riêng) — xem comment tại
 * hàm đó.
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

/** Firestore của app Công nợ — chỉ 1 hàm GHI duy nhất được export từ file
 * này (`createSubcontractorInCongNo`, cuối file), mọi chỗ khác chỉ đọc. */
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
 * 🔴 CHỈ đọc và forward đúng 5 field `ma`/`mst`/`ten`/`tenVietTat`/`diaChi` —
 * collection này còn có `nguon`, `hopDong` (mảng hợp đồng gắn với nhà thầu),
 * `createdAt`, `updatedAt`, `updatedBy` KHÔNG được lộ ra bất kỳ đâu ngoài
 * file này. `tenVietTat` (Tên viết tắt) là field Công nợ mới thêm 30/09/2026.
 *
 * Nhà thầu do hệ thống Công nợ TỰ THÊM lúc "Ký kết hợp đồng" thường chỉ có
 * `mst`, không có `ma` (xem `ghiNhanNhaThauKhiKyKet` trong HPCons-Congno/
 * lib/subcontractors.ts) — filter bỏ bản ghi thiếu CẢ `ma` LẪN `mst` LẪN
 * `ten` (không có gì để khớp — trong thực tế hiếm xảy ra vì `ten` là field
 * bắt buộc bên Công nợ), còn thiếu 1-2 trong 3 thì vẫn giữ.
 */
export interface SubcontractorCodeSuggestion {
  ma: string;
  mst: string;
  ten: string;
  tenVietTat: string;
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
        tenVietTat: typeof data.tenVietTat === "string" ? data.tenVietTat.trim() : "",
        diaChi: typeof data.diaChi === "string" ? data.diaChi.trim() : "",
      };
    })
    .filter((s) => s.ma || s.mst || s.ten);
}

/** Cache 5 phút — cùng lý do/thời hạn với `loadContractCodeSuggestions` (dùng
 * chung cho cả gợi ý lẫn validate, xem lib/external-code-sources.ts). Có
 * `tags` (khác `loadContractCodeSuggestions`, chưa cần) để
 * `createSubcontractorInCongNo` bên dưới làm mới NGAY sau khi ghi — không
 * đợi hết 5 phút mới chọn được nhà thầu vừa thêm. */
export const loadSubcontractorCodeSuggestions = unstable_cache(
  loadSubcontractorCodeSuggestionsUncached,
  ["subcontractor-code-suggestions"],
  { revalidate: 300, tags: ["subcontractor-code-suggestions"] },
);

export interface NewSubcontractorInput {
  ten: string;
  /** Để trống → tự tính bằng `ntpVietTat` (y hệt Công nợ tự làm lúc hiển thị
   * nếu field này rỗng — xem lib/ntp-viet-tat.ts). */
  tenVietTat?: string;
  mst: string;
  nhom: "THẦU PHỤ" | "TỔ ĐỘI";
  diaChi?: string;
  /** Tên người đã thêm (lấy từ phiên đăng nhập SSO, KHÔNG tin giá trị client
   * gửi lên — route gọi hàm này phải tự lấy từ `requireSession().name`). */
  nguoiThem: string;
}

/**
 * GHI MỚI 1 nhà thầu phụ vào Công nợ — Sếp chốt 01/10/2026 (change
 * add-create-subcontractor-from-request): dùng thẳng Admin SDK hiện có thay
 * vì gọi route POST của Công nợ (route đó không tự validate gì, lại đòi 1
 * loại ID token riêng của project Công nợ mà app Đề xuất chưa có cơ chế lấy
 * — phức tạp hơn mà không an toàn hơn).
 *
 * KHÔNG đụng field `nguon` cũ (enum "goc"|"xetduyet", Công nợ dùng để tự hiện
 * badge "Danh sách gốc"/"Từ xét duyệt" + lọc/thống kê riêng — xem
 * HPCons-Congno/components/Subcontractors.tsx) — ghi `"goc"` y như Admin Công
 * nợ tự thêm tay qua UI của họ, không tạo giá trị lạ nào có thể làm vỡ UI đó.
 * Thay vào đó lưu thêm 1 field MỚI, RIÊNG — `ghiChuNguon` — là 1 ghi chú tự
 * do, CHỈ để ai mở thẳng dữ liệu Firestore thấy được nguồn gốc bản ghi; Sếp
 * xác nhận 01/10/2026 KHÔNG cần hiện field này ở đâu trong giao diện Công nợ.
 *
 * Validate tối thiểu (Công nợ hoàn toàn không validate gì ở phía họ — xem
 * comment route.ts của họ — nên toàn bộ hàng rào phải nằm ở đây): `ten`/`mst`
 * bắt buộc non-empty, đúng yêu cầu Sếp (nghiêm hơn chính Công nợ, nơi chỉ bắt
 * buộc `ten`).
 */
export async function createSubcontractorInCongNo(
  input: NewSubcontractorInput,
): Promise<{ id: string; record: SubcontractorCodeSuggestion }> {
  const ten = input.ten.trim();
  const mst = input.mst.trim();
  if (!ten) throw new Error("Thiếu tên nhà cung cấp.");
  if (!mst) throw new Error("Thiếu MST hoặc CCCD.");
  const tenVietTat = input.tenVietTat?.trim() || ntpVietTat(ten);
  const diaChi = input.diaChi?.trim() || "";
  const now = new Date().toISOString();
  const nguoiThem = input.nguoiThem.trim();

  const doc = await getCongNoDb()
    .collection("subcontractors")
    .add({
      ten,
      tenVietTat,
      mst,
      nhom: input.nhom,
      diaChi,
      nguon: "goc",
      ghiChuNguon: nguoiThem ? `Thêm qua app Đề xuất — ${nguoiThem}` : "Thêm qua app Đề xuất",
      createdAt: now,
      updatedAt: now,
    });

  revalidateTag("subcontractor-code-suggestions");

  return {
    id: doc.id,
    record: { ma: "", mst, ten, tenVietTat, diaChi },
  };
}
