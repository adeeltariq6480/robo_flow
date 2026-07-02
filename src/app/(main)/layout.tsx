import { MainShell } from "@/components/layout/main-shell";

/** Always render with live env + API — avoids stale static pages on Vercel. */
export const dynamic = "force-dynamic";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainShell>{children}</MainShell>;
}
