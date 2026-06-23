import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/utils";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const user = await getUser();
  if (user) redirect("/projects");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Bot className="h-6 w-6 text-brand-600" />
            Robo Flow
          </div>
          <div className="flex gap-3">
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Robotics vision workflows, simplified
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-500">
          Manage projects, label classes, upload datasets, and deploy models —
          all in one place.
        </p>
        <div className="mt-8 flex gap-4">
          <Link href="/signup">
            <Button className="px-6 py-3 text-base">Create free account</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" className="px-6 py-3 text-base">
              Sign in
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
