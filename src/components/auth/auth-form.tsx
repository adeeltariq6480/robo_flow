"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import {
  establishSession,
  registerUserProfile,
} from "@/lib/actions/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LabelAILogo } from "@/components/layout/label-ai-logo";
import Link from "next/link";

interface AuthFormProps {
  mode: "login" | "register";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const auth = getClientAuth();
      let credential;

      if (mode === "register") {
        if (!fullName.trim()) {
          setError("Full name is required");
          setLoading(false);
          return;
        }
        credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        const profileResult = await registerUserProfile({
          uid: credential.user.uid,
          fullName: fullName.trim(),
          email: email.trim(),
        });
        if (profileResult.error) {
          setError(profileResult.error);
          setLoading(false);
          return;
        }
      } else {
        credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
      }

      const idToken = await credential.user.getIdToken();
      const sessionResult = await establishSession(idToken);
      if (sessionResult.error) {
        setError(sessionResult.error);
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <LabelAILogo />
        </div>
        <h1 className="text-center text-lg font-semibold text-slate-900">
          {mode === "login" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          {mode === "login"
            ? "Access your labeling projects"
            : "Start auto-labelling with YOLO models"}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Full name
              </label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link href="/register" className="text-brand-600 hover:underline">
                Register
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-brand-600 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
