import { Tags } from "lucide-react";

interface LabelAILogoProps {
  compact?: boolean;
  className?: string;
}

export function LabelAILogo({ compact = false, className = "" }: LabelAILogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 shadow-sm"
        aria-hidden
      >
        <Tags className="h-5 w-5 text-white" strokeWidth={2.25} />
      </div>
      {!compact && (
        <span className="text-lg font-bold tracking-tight text-slate-900">
          Label <span className="text-brand-600">AI</span>
        </span>
      )}
    </div>
  );
}
