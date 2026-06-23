import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function SetupErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="max-w-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Supabase not configured
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              This app uses <strong>Supabase only</strong> — there is no Firebase
              in this project. The Internal Server Error happens when environment
              variables are missing or misnamed.
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-600">
              <li>
                Create a file named{" "}
                <code className="rounded bg-slate-100 px-1">.env.local</code> in the
                project root (same folder as package.json)
              </li>
              <li>
                <strong>Do not</strong> use{" "}
                <code className="rounded bg-slate-100 px-1">.env.example</code> — Next.js
                does not load it automatically
              </li>
              <li>
                Add{" "}
                <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
                and{" "}
                <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
                from Supabase Dashboard → Settings → API
              </li>
              <li>
                Restart: <code className="rounded bg-slate-100 px-1">npm run dev</code>
              </li>
            </ol>
            <Link href="/" className="mt-6 inline-block">
              <Button variant="secondary">Back to home</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
