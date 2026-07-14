interface AxiomAILogoProps {
  compact?: boolean;
  className?: string;
}

function AxiomMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 2.5L3.5 20h4.1l1.2-2.8h9.4l1.2 2.8H20.5L12 2.5z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M12 8.2l3.1 7.1H8.9L12 8.2z"
        fill="url(#axiom-ai-gradient)"
      />
      <defs>
        <linearGradient id="axiom-ai-gradient" x1="8" y1="8" x2="16" y2="16">
          <stop stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function AxiomAILogo({ compact = false, className = "" }: AxiomAILogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 via-teal-600 to-violet-600 shadow-lg shadow-emerald-500/20 ring-1 ring-white/70"
        aria-hidden
      >
        <AxiomMark className="h-5 w-5 text-white" />
      </div>
      {!compact && (
        <span className="text-lg font-bold tracking-tight text-slate-900">
          Axiom{" "}
          <span className="bg-gradient-to-r from-emerald-600 via-cyan-600 to-violet-600 bg-clip-text text-transparent">
            AI
          </span>
        </span>
      )}
    </div>
  );
}
