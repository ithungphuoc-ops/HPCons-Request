"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequestDetailView from "@/components/request/RequestDetailView";
import type { RequestInstance } from "@/lib/types";

interface CodeMatch {
  id: string;
  code: string | null;
  groupName: string;
  submittedAt: string;
}

async function docJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Không thể tải đề xuất.");
  return body as T;
}

/** Trang `/request/<mã>`: tra mã → id rồi hiện y hệt `/request/requests/[id]`. */
export default function RequestByCodeView({ code }: { code: string }) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [matches, setMatches] = useState<CodeMatch[] | null>(null);
  const [request, setRequest] = useState<RequestInstance | null>(null);
  // Máy chủ tính sẵn trong cùng lượt GET (như trang /request/requests/[id]).
  const [viewerAdjustmentAccess, setViewerAdjustmentAccess] = useState<"gated" | "none">("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/requests/by-code/${encodeURIComponent(code)}`)
      .then((res) => docJson<{ matches: CodeMatch[] }>(res))
      .then((data) => {
        if (data.matches.length === 1) setRequestId(data.matches[0].id);
        else setMatches(data.matches);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Có lỗi xảy ra."));
  }, [code]);

  const load = useCallback(() => {
    if (!requestId) return;
    fetch(`/api/requests/${requestId}`)
      .then((res) => docJson<{ request: RequestInstance; viewerAdjustmentAccess?: "gated" | "none" }>(res))
      .then((data) => {
        setRequest(data.request);
        setViewerAdjustmentAccess(data.viewerAdjustmentAccess ?? "none");
        // Gõ thiếu số 0 (`/request/162`) thì thanh địa chỉ tự sửa về đúng mã.
        if (data.request.code && data.request.code !== code) {
          window.history.replaceState(null, "", `/request/${data.request.code}`);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Có lỗi xảy ra."));
  }, [requestId, code]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { uid: string } | null) => setCurrentUid(data?.uid ?? null))
      .catch(() => setCurrentUid(null));
  }, []);

  return (
    <div className="px-4 py-4 md:px-8 md:py-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="print-hide mb-3 text-[12px] text-gray-500 hover:underline"
      >
        ← Quay lại
      </button>

      {loadError && <p className="text-[14px] text-[var(--color-danger-red)]">{loadError}</p>}

      {!loadError && matches && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-semibold">
            Có {matches.length} đề xuất mang mã {code}. Chọn đề xuất cần xem:
          </p>
          {matches.map((m) => (
            <Link
              key={m.id}
              href={`/request/requests/${m.id}`}
              className="rounded border border-gray-200 px-3 py-2 text-[13px] hover:border-gray-400"
            >
              <b>{m.code ?? code}</b> · {m.groupName} · {new Date(m.submittedAt).toLocaleDateString("vi-VN")}
            </Link>
          ))}
        </div>
      )}

      {!loadError && !matches && !request && <p className="text-[14px] text-gray-400">Đang tải...</p>}
      {request && (
        <RequestDetailView
          request={request}
          currentUid={currentUid}
          viewerAdjustmentAccess={viewerAdjustmentAccess}
          onActed={load}
        />
      )}
    </div>
  );
}
