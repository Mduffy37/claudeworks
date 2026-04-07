import { useState, useEffect } from "react";
import type { PluginWithItems } from "../../electron/types";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginWithItems[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.getPlugins().then((data) => {
      setPlugins(data);
      setLoading(false);
    });
  }, []);

  return { plugins, loading };
}
