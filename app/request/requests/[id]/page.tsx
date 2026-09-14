"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RequestDetailView from "@/components/request/RequestDetailView";
import type { RequestInstance } from "@/lib/types";

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<RequestInstance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/requests/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error ?? "Không thể tải đề xuất.");
        }
        return res.json() as Promise<{ request: RequestInstance }>;
      })
      .then((data) => setRequest(data.request))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Có lỗi xảy ra."));
  };

  useEffect(load, [params.id]);

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
        className="mb-3 text-[12px] text-gray-500 hover:underline"
      >
        ← Quay lại
      </button>

      {loadError && <p className="text-[14px] text-[var(--color-danger-red)]">{loadError}</p>}
      {!loadError && !request && <p className="text-[14px] text-gray-400">Đang tải...</p>}
      {request && (
        <RequestDetailView request={request} currentUid={currentUid} onActed={load} />
      )}
    </div>
  );
}
