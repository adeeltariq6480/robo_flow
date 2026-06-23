import { AuthForm } from "@/components/auth/auth-form";
import { Bot } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold text-slate-900">
        <Bot className="h-7 w-7 text-brand-600" />
        Robo Flow
      </div>
      <AuthForm mode="login" />
    </div>
  );
}
