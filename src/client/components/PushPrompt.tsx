import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import {
  pushSupported,
  notificationPermission,
  enablePush,
  isPushEnabled,
} from "../push.ts";
import { Button } from "@/components/ui/button.tsx";

const DISMISS_KEY = "remember.pushPromptDismissed";

// A one-time banner nudging the user to turn on notifications for this device,
// so the Reminders they set actually arrive. Hidden once enabled, denied, or
// dismissed. Enabling subscribes this device (push.ts -> backend).
export function PushPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;
      if (notificationPermission() === "denied") return;
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      if (await isPushEnabled()) return;
      if (!cancelled) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const ok = await enablePush();
      if (ok) setVisible(false);
      else setError("Notifications were not allowed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable reminders.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-sm">
      <Bell className="size-4 shrink-0 text-primary" />
      <span className="flex-1">
        Turn on notifications to get your reminders on this device.
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button size="sm" onClick={enable} disabled={busy}>
        {busy ? "Enabling…" : "Enable"}
      </Button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
