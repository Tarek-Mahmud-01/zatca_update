"use client";

import { useEffect, useState } from "react";

export type Env = "sandbox" | "simulation" | "production";

const KEY = "zatca.activeEnv";

export function getActiveEnv(): Env {
  if (typeof window === "undefined") return "sandbox";
  const v = window.localStorage.getItem(KEY);
  return v === "simulation" || v === "production" ? v : "sandbox";
}

export function setActiveEnv(env: Env) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, env);
  window.dispatchEvent(new CustomEvent("activeEnvChange", { detail: env }));
}

export function useActiveEnv(): [Env, (e: Env) => void] {
  const [env, setEnv] = useState<Env>("sandbox");

  useEffect(() => {
    setEnv(getActiveEnv());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Env>).detail;
      if (detail) setEnv(detail);
    };
    window.addEventListener("activeEnvChange", onChange);
    return () => window.removeEventListener("activeEnvChange", onChange);
  }, []);

  return [env, (e) => { setActiveEnv(e); setEnv(e); }];
}
