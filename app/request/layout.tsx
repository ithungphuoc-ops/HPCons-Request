import { Suspense } from "react";
import { RequestProvider } from "@/context/RequestContext";
import { CurrentSessionProvider } from "@/lib/useCurrentSession";
import AppBar from "@/components/request/AppBar";
import FuncBar from "@/components/request/FuncBar";
import RequestModalHost from "@/components/request/RequestModalHost";
import { FUNCBAR_PREPAINT_SCRIPT } from "@/lib/funcbar-prefs";

export default function RequestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Áp độ rộng / trạng thái ẩn đã lưu của thanh chức năng TRƯỚC khi vẽ — xem lib/funcbar-prefs.ts. */}
      <script dangerouslySetInnerHTML={{ __html: FUNCBAR_PREPAINT_SCRIPT }} />
      <CurrentSessionProvider>
        <RequestProvider>
          <div className="request-app-shell flex h-screen w-screen overflow-hidden bg-[var(--color-page-bg)]">
            <AppBar />
            <Suspense fallback={null}>
              <FuncBar />
            </Suspense>
            <main className="request-app-main h-full min-w-0 flex-1 overflow-y-auto">{children}</main>
            <RequestModalHost />
          </div>
        </RequestProvider>
      </CurrentSessionProvider>
    </>
  );
}
