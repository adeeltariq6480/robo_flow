import { type ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/80 bg-white/90 p-6 shadow-[0_10px_35px_-18px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/70 backdrop-blur-sm transition-all duration-300 hover:shadow-[0_16px_45px_-20px_rgba(5,150,105,0.22)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className || "mb-6"}`}>
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-950">{title}</h2>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
