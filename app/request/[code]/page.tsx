// Mở đề xuất theo mã hiển thị: request.hpcore.vn/request/000000162 (Sếp 02/10/2026).
import { notFound } from "next/navigation";
import RequestByCodeView from "@/components/request/RequestByCodeView";

export default async function RequestByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!/^\d+$/.test(code)) notFound();
  return <RequestByCodeView code={code} />;
}
