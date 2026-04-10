import { useState, useEffect, useCallback } from "react";
import type { PluginWithItems } from "../../electron/types";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    window.api.getPlugins().then((data) => {
      setPlugins(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    // Silently refresh without setting loading — avoids unmounting the entire UI
    window.api.getPlugins().then((data) => {
      setPlugins(data);
    });
  }, []);

  const checkForUpdates = useCallback(async () => {
    const updates = await window.api.checkPluginUpdates();
    setAvailableUpdates(updates);
    return updates;
  }, []);

  return { plugins, loading, refresh, availableUpdates, checkForUpdates };
}
