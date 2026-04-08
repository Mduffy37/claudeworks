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
    load();
  }, [load]);

  const checkForUpdates = useCallback(async () => {
    const updates = await window.api.checkPluginUpdates();
    setAvailableUpdates(updates);
    return updates;
  }, []);

  return { plugins, loading, refresh, availableUpdates, checkForUpdates };
}
