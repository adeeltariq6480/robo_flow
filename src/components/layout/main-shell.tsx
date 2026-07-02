"use client";

import { Suspense, type ReactNode } from "react";
import { NavigationProvider } from "@/contexts/navigation-context";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { PageTransition } from "@/components/layout/page-transition";
import { MainContent } from "@/components/layout/main-content";

function ShellInner({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <Suspense fallback={null}>
        <NavigationProvider>
          <NavigationProgress />
          <AppSidebar />
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 lg:p-8">
            <PageTransition />
            <MainContent>{children}</MainContent>
          </main>
        </NavigationProvider>
      </Suspense>
    </div>
  );
}

export function MainShell({ children }: { children: ReactNode }) {
  return <ShellInner>{children}</ShellInner>;
}
