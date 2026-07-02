import { Suspense } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NavigationProgress } from "@/components/layout/navigation-progress";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <AppSidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 lg:p-8">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}