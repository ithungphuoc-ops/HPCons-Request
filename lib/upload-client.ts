import type { RequestAttachment } from "@/lib/types";
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";

type SignedItem = { name: string; path: string; contentType: string; url: string };

/**
 * Tải tệp đính kèm — dùng chung cho trang soạn đề xuất, ô thảo luận và khu vực
 * bổ sung sau duyệt (13/09/2026).
 *
 * Đường CHÍNH: xin link ký sẵn rồi PUT THẲNG lên R2, không đi qua Vercel nên
 * không dính trần body 4,5MB.
 *
 * Đường LUI: nếu PUT hỏng vì bucket chưa bật CORS (trình duyệt chặn trước khi
 * gọi, lỗi hiện ra là TypeError "Failed to fetch" chứ không có mã HTTP), quay
 * về đường cũ `/api/uploads` — vẫn chạy được với tệp ≤ 4MB, để app không chết
 * hẳn trong lúc chờ bật CORS.
 */
export async function uploadAttachments(files: File[]): Promise<RequestAttachment[]> {
  const signRes = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) }),
  });
  if (!signRes.ok) {
    const body = (await signRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Không xin được link tải lên.");
  }
  const { items } = (await signRes.json()) as { items: SignedItem[] };

  const results = await Promise.allSettled(
    files.map(async (file, i) => {
      const res = await fetch(items[i].url, {
        method: "PUT",
        headers: { "Content-Type": items[i].contentType },
        body: file,
      });
      if (!res.ok) throw new Error(`R2 trả ${res.status}`);
    }),
  );

  const failedIndexes = results
    .map((r, i) => (r.status === "rejected" ? i : -1))
    .filter((i) => i >= 0);

  // Tệp nào lên thẳng được thì GIỮ NGUYÊN, chỉ tệp hỏng mới đi đường lui —
  // trước đây 1 tệp hỏng là tải lại TẤT CẢ qua máy chủ, mấy tệp đã lên thẳng
  // thành rác không ai tham chiếu trong R2 (CodeRabbit bắt trên PR #15).
  const attachments: RequestAttachment[] = files.map((file, i) => ({
    name: file.name,
    path: items[i].path,
    size: file.size,
  }));
  if (failedIndexes.length === 0) return attachments;

  const retried = await uploadThroughServer(failedIndexes.map((i) => files[i]));
  failedIndexes.forEach((fileIndex, order) => {
    attachments[fileIndex] = retried[order];
  });
  return attachments;
}

/** Đường cũ: đẩy file qua serverless function. Chỉ còn dùng làm đường lui. */
async function uploadThroughServer(files: File[]): Promise<RequestAttachment[]> {
  const tooBig = files.find((f) => f.size > MAX_UPLOAD_FILE_SIZE);
  if (tooBig) {
    throw new Error(
      `Chưa tải thẳng lên kho được (kho chưa bật CORS) và tệp "${tooBig.name}" vượt quá ${MAX_UPLOAD_FILE_SIZE_LABEL} — báo bộ phận IT giúp em.`,
    );
  }
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  const res = await fetch("/api/uploads", { method: "POST", body: formData });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Không thể tải tệp lên.");
  }
  const data = (await res.json()) as { attachments: RequestAttachment[] };
  return data.attachments;
}
