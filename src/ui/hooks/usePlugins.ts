import { useState, useEffect, useCallback } from "react";
import type { PluginWithItems } from "../../electron/types";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, string>>({});

  // Same rationale as useProfiles: without the catch, a rejected getPlugins()
  // promise leaves loading=true forever and freezes the splash.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getPlugins();
      setPlugins(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    // Silently refresh without setting loading — avoids unmounting the entire UI
    try {
      const data = await window.api.getPlugins();
      setPlugins(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    const updates = await window.api.checkPluginUpdates();
    setAvailableUpdates(updates);
    return updates;
  }, []);

  return { plugins, loading, error, refresh, reload: load, availableUpdates, checkForUpdates };
}
