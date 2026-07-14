"use client";

import { Suspense, type ReactNode } from "react";
import { NavigationProvider } from "@/contexts/navigation-context";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { PageTransition } from "@/components/layout/page-transition";
import { MainContent } from "@/components/layout/main-content";

function ShellInner({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,_#ecfdf5_0,_#f8fafc_38%,_#eff6ff_72%,_#faf5ff_100%)]">
      <Suspense fallback={null}>
        <NavigationProvider>
          <NavigationProgress />
          <AppSidebar />
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 sm:p-6 lg:p-8">
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
