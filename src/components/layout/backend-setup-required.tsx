"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ServerCrash } from "lucide-react";

interface BackendSetupRequiredProps {
  message: string;
  /** Shown on the home page when the user can still browse docs */
  showHomeActions?: boolean;
}

export function BackendSetupRequired({
  message,
  showHomeActions = true,
}: BackendSetupRequiredProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <Card className="text-center">
        <ServerCrash className="mx-auto h-12 w-12 text-amber-500" />
        <CardHeader
          title="Backend not reachable"
          description="The frontend could not contact the FastAPI API during server rendering. If Railway logs show the worker is running, refresh — it may have been restarting."
        />
        <Alert variant="error">{message}</Alert>
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
        </div>
        <div className="mt-6 space-y-3 text-left text-sm text-slate-600">
          <p className="font-medium text-slate-800">On Railway (worker):</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Set <code className="text-xs">SUPABASE_URL</code> and{" "}
              <code className="text-xs">SUPABASE_SERVICE_ROLE_KEY</code> (see{" "}
              <code className="text-xs">docs/supabase-setup.md</code>).
            </li>
            <li>
              Run <code className="text-xs">supabase/schema_full.sql</code> in
              your Supabase SQL Editor.
            </li>
          </ol>
          <p className="font-medium text-slate-800">On Vercel (production):</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Deploy the Python worker (<code className="text-xs">worker/</code>)
              to a public host (Railway, Render, Fly.io, a VPS, etc.).
            </li>
            <li>
              In Vercel → <strong>Settings → Environment Variables</strong>, set{" "}
              <code className="text-xs">NEXT_PUBLIC_WORKER_API_URL</code> to that
              public URL (not <code className="text-xs">localhost</code>).
            </li>
            <li>Redeploy the frontend after saving the variable.</li>
          </ol>
          <p className="font-medium text-slate-800">Locally:</p>
          <p>
            Run <code className="text-xs">uvicorn main:app --reload --port 8000</code>{" "}
            in <code className="text-xs">worker/</code> and keep{" "}
            <code className="text-xs">NEXT_PUBLIC_WORKER_API_URL=http://localhost:8000</code>{" "}
            in <code className="text-xs">.env.local</code>.
          </p>
        </div>
        {showHomeActions && (
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/">
              <Button variant="secondary">Retry</Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
