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
              Firebase not configured
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Label AI uses <strong>Firebase</strong> for authentication, database,
              and storage. This error appears when environment variables are missing
              or still contain placeholder values.
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-600">
              <li>
                Create{" "}
                <code className="rounded bg-slate-100 px-1">.env.local</code> in the
                project root
              </li>
              <li>
                Copy variables from{" "}
                <code className="rounded bg-slate-100 px-1">.env.local.example</code>
              </li>
              <li>
                Add Firebase client config from Firebase Console → Project settings
              </li>
              <li>
                Add{" "}
                <code className="rounded bg-slate-100 px-1">
                  FIREBASE_SERVICE_ACCOUNT_JSON
                </code>{" "}
                for server-side operations (single-line JSON)
              </li>
              <li>Restart the dev server after saving</li>
            </ol>
            <p className="mt-4 text-sm text-slate-600">
              See <code className="rounded bg-slate-100 px-1">docs/firebase-migration-plan.md</code>{" "}
              for full setup instructions.
            </p>
            <Link href="/" className="mt-4 inline-block">
              <Button variant="secondary">Back to app</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
