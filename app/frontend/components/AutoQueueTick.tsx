"use client";

import { useEffect, useRef, useState } from "react";
import { api, type TenantSettings } from "../lib/api-client";
import { getToken } from "../lib/token";
import { pushNotification } from "../lib/notifications";

const TICK_MS = 60_000;             // poll the tenant config + process-queue once a minute
const CONFIG_REFRESH_MS = 5 * 60_000;

/**
 * Mounted once at the dashboard layout. When the tenant's queue strategy is
 * "queued", calls /process-queue every minute. The backend decides whether
 * the current minute matches one of the tenant's scheduled HH:MM times and,
 * if so, drains the whole queue in one batch. Off-schedule ticks are no-ops.
 * We only notify when invoices were actually released, so off-schedule
 * minutes are silent.
 */
export function AutoQueueTick() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const lastConfigAt = useRef(0);

  useEffect(() => {
    let stopped = false;

    async function refreshConfig() {
      const token = getToken();
      if (!token) return;
      try {
        setSettings(await api.getTenantSettings(token));
        lastConfigAt.current = Date.now();
      } catch { /* ignore — keep last */ }
    }

    async function tick() {
      if (stopped) return;
      const token = getToken();
      if (!token) return;
      if (Date.now() - lastConfigAt.current > CONFIG_REFRESH_MS) {
        await refreshConfig();
      }
      if (settings?.queue_strategy !== "queued") return;
      try {
        const res = await api.processQueue(token, { force: false });
        if (res.released > 0) {
          pushNotification({
            tone: "success",
            title: `Auto-released ${res.released} from queue`,
            body: `${res.remaining_queued} still waiting`,
          });
        }
      } catch { /* swallow — Redis may be down */ }
    }

    refreshConfig();
    const id = window.setInterval(tick, TICK_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [settings?.queue_strategy]);

  return null;
}
