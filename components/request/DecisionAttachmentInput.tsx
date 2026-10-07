"use client";

// Ô chọn tệp to (kéo thả) cũ đã thay bằng NoteWithAttachments (ô gọn kiểu
// Thảo luận, demo dieu-chinh-o-gon-kieu-thao-luan-2026-10-07); file này giữ
// các hàm dùng chung: nhãn đuôi tệp + tải tệp quyết định lên R2.

import { useRef } from "react";
import { uploadAttachments } from "@/lib/upload-client";
import type { RequestAttachment } from "@/lib/types";

/** Nhãn đuôi tệp ngắn trên chip ("PDF", "XLSX"…). */
export function fileExtLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : "TỆP";
}

/**
 * Tải các tệp đã chọn lên R2 lúc bấm xác nhận — CÙNG cách luồng "Điều chỉnh
 * sau duyệt" (AdjustmentControl ở RequestDetailView): giữ `File` trong máy,
 * chỉ tải THẲNG lên R2 (link ký sẵn, lib/upload-client.ts) khi gửi quyết
 * định, rồi mới gọi route. Bấm Huỷ trước khi xác nhận → không tải gì.
 *
 * Nhớ tệp đã tải theo đúng đối tượng `File`: gửi quyết định lỗi (vd máy chủ
 * trả 409) rồi bấm lại thì KHÔNG tải lại tệp lần 2 (đỡ thêm tệp mồ côi).
 */
export function useDecisionAttachmentUploader() {
  const cache = useRef(new WeakMap<File, RequestAttachment>());
  return async (files: File[]): Promise<RequestAttachment[]> => {
    const pending = files.filter((f) => !cache.current.has(f));
    if (pending.length > 0) {
      const uploaded = await uploadAttachments(pending);
      pending.forEach((f, i) => {
        if (uploaded[i]) cache.current.set(f, uploaded[i]);
      });
    }
    return files.map((f) => {
      const att = cache.current.get(f);
      if (!att) throw new Error(`Không tải được tệp "${f.name}" lên.`);
      return att;
    });
  };
}
