"use client";

import { useActiveEnv, type Env } from "../lib/active-env";

const ENVS: ReadonlyArray<{ value: Env; label: string; tone: string; help: string }> = [
  { value: "sandbox",    label: "Sandbox",    tone: "neutral", help: "ZATCA developer portal — for first integration & smoke tests" },
  { value: "simulation", label: "Simulation", tone: "neutral", help: "Pre-prod mirror — used for UAT" },
  { value: "production", label: "Production", tone: "danger",  help: "Live tax submission — real invoices count" },
];

export function EnvSwitcher() {
  const [env, setEnv] = useActiveEnv();
  const active = ENVS.find((e) => e.value === env)!;

  return (
    <div className="flex flex-col gap-2">
      <div className="label">API target</div>
      <div className="flex flex-wrap gap-1.5">
        {ENVS.map((e) => {
          const isActive = env === e.value;
          return (
            <button
              key={e.value}
              type="button"
              onClick={() => setEnv(e.value)}
              title={e.help}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors
                ${isActive
                  ? "bg-[var(--color-bg-soft)] text-[var(--color-fg)] border-[var(--color-fg-2)] font-medium"
                  : "bg-white text-[var(--color-fg-muted)] border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"}`}
            >
              {e.label}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">{active.help}</div>
    </div>
  );
}

export function EnvBadge() {
  const [env] = useActiveEnv();
  const active = ENVS.find((e) => e.value === env)!;
  const tone =
    env === "production" ? "badge-danger" :
    env === "simulation" ? "badge-warning" :
    "badge-neutral";
  return (
    <span className={`badge ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {active.label}
    </span>
  );
}
