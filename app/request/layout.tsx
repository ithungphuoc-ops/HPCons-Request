import { Suspense } from "react";
import { RequestProvider } from "@/context/RequestContext";
import AppBar from "@/components/request/AppBar";
import FuncBar from "@/components/request/FuncBar";
import RequestModalHost from "@/components/request/RequestModalHost";

export default function RequestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
