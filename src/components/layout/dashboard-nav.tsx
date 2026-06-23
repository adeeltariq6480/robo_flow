import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Bot, LogOut } from "lucide-react";

export function DashboardNav({ email }: { email?: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/projects" className="flex items-center gap-2 font-semibold text-slate-900">
          <Bot className="h-6 w-6 text-brand-600" />
          Robo Flow
        </Link>
        <div className="flex items-center gap-4">
          {email && (
            <span className="hidden text-sm text-slate-500 sm:block">{email}</span>
          )}
          <form action={signOut}>
            <Button type="submit" variant="ghost" className="text-sm">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
