"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn, signUp } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

interface AuthFormProps {
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);

    const result =
      mode === "login" ? await signIn(formData) : await signUp(formData);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <Card className="w-full max-w-md">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">
          {isLogin ? "Welcome back" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isLogin
            ? "Sign in to manage your robotics projects"
            : "Get started with Robo Flow"}
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <form action={handleSubmit} className="space-y-4">
        {!isLogin && (
          <Input
            label="Full name"
            name="fullName"
            type="text"
            placeholder="Jane Doe"
            required
          />
        )}
        <Input
          label="Email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
        <Input
          label="Password"
          name="password"
          type="password"
          placeholder="••••••••"
          required
          minLength={6}
          autoComplete={isLogin ? "current-password" : "new-password"}
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
        <Link
          href={isLogin ? "/signup" : "/login"}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {isLogin ? "Sign up" : "Sign in"}
        </Link>
      </p>
    </Card>
  );
}
