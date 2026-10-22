import type { ReactNode } from "react";

export function AppHeader({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  return (
    <header className="app-header navbar border-b border-base-300 bg-base-100 px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        {children}
        <span className={`text-xl font-semibold ${compact ? "hidden sm:inline" : ""}`}>Overlay</span>
      </div>
    </header>
  );
}
