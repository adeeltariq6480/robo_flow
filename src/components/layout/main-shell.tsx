"use client";

import { Suspense, type ReactNode } from "react";
import { NavigationProvider } from "@/contexts/navigation-context";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { PageTransition } from "@/components/layout/page-transition";
import { MainContent } from "@/components/layout/main-content";
import { GenericPageSkeleton } from "@/components/layout/page-skeletons";

function ShellInner({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <div className="flex h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <NavigationProgress />
        <AppSidebar />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 lg:p-8">
          <PageTransition />
          <MainContent>{children}</MainContent>
        </main>
      </div>
    </NavigationProvider>
  );
}

function ShellFallback() {
  return (
    <div className="flex h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <aside className="h-dvh w-64 shrink-0 border-r border-slate-200/80 bg-white" />
      <main className="min-w-0 flex-1 overflow-hidden p-6 lg:p-8">
        <GenericPageSkeleton />
      </main>
    </div>
  );
}

export function MainShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}
