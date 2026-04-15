import type { PluginWithItems } from "../../../src/electron/types";

interface UsePluginTogglesArgs {
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  setSelectedPlugins: React.Dispatch<React.SetStateAction<string[]>>;
  excludedItems: Record<string, string[]>;
  setExcludedItems: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  markDirty: () => void;
}

export function usePluginToggles({
  plugins,
  selectedPlugins,
  setSelectedPlugins,
  excludedItems,
  setExcludedItems,
  markDirty,
}: UsePluginTogglesArgs) {
  const resolveRef = (ref: string) => {
    const [refPlugin, refItem] = ref.split(":");
    const plugin = plugins.find(
      (p) => p.pluginName === refPlugin || p.name.startsWith(refPlugin + "@")
    );
    if (!plugin) return null;
    const item = plugin.items.find((i) => i.name === refItem);
    if (!item) return null;
    return { plugin, item };
  };

  const enableDependencies = (
    item: { dependencies: string[] },
    newSelectedPlugins: string[],
    newExcludedItems: Record<string, string[]>,
    visited: Set<string> = new Set()
  ) => {
    for (const dep of item.dependencies) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      const resolved = resolveRef(dep);
      if (!resolved) continue;
      const { plugin: depPlugin, item: depItem } = resolved;
      if (!newSelectedPlugins.includes(depPlugin.name)) {
        newSelectedPlugins.push(depPlugin.name);
        newExcludedItems[depPlugin.name] = depPlugin.items
          .map((i) => i.name)
          .filter((n) => n !== depItem.name);
      } else {
        const excluded = newExcludedItems[depPlugin.name] ?? [];
        newExcludedItems[depPlugin.name] = excluded.filter((n) => n !== depItem.name);
      }
      if (depItem.dependencies.length > 0) {
        enableDependencies(depItem, newSelectedPlugins, newExcludedItems, visited);
      }
    }
  };

  const handleTogglePlugin = (pluginName: string, enabled: boolean) => {
    setSelectedPlugins((prev) =>
      enabled ? [...prev, pluginName] : prev.filter((n) => n !== pluginName)
    );
    if (!enabled) {
      setExcludedItems((prev) => {
        const next = { ...prev };
        delete next[pluginName];
        return next;
      });
    }
    markDirty();
  };

  const handleToggleItem = (pluginName: string, itemName: string, enabled: boolean) => {
    const newExcluded = { ...excludedItems };
    const newSelected = [...selectedPlugins];
    const current = newExcluded[pluginName] ?? [];

    if (enabled) {
      newExcluded[pluginName] = current.filter((n) => n !== itemName);
      const plugin = plugins.find((p) => p.name === pluginName);
      const item = plugin?.items.find((i) => i.name === itemName);
      if (item && item.dependencies.length > 0) {
        enableDependencies(item, newSelected, newExcluded);
        setSelectedPlugins(newSelected);
      }
    } else {
      newExcluded[pluginName] = [...current, itemName];
    }

    setExcludedItems(newExcluded);
    markDirty();
  };

  const handleEnablePluginWithOnly = (pluginName: string, itemName: string) => {
    const newSelected = [...selectedPlugins, pluginName];
    const newExcluded = { ...excludedItems };
    const plugin = plugins.find((p) => p.name === pluginName);
    if (plugin) {
      newExcluded[pluginName] = plugin.items
        .map((i) => i.name)
        .filter((n) => n !== itemName);
      const item = plugin.items.find((i) => i.name === itemName);
      if (item && item.dependencies.length > 0) {
        enableDependencies(item, newSelected, newExcluded);
      }
    }
    setSelectedPlugins(newSelected);
    setExcludedItems(newExcluded);
    markDirty();
  };

  const handleToggleGroup = (
    groupItems: Array<{ pluginName: string; itemName: string; dependencies?: string[] }>,
    enable: boolean
  ) => {
    if (groupItems.length === 0) return;
    const newSelected = [...selectedPlugins];
    const newExcluded: Record<string, string[]> = { ...excludedItems };
    const pluginNames = Array.from(new Set(groupItems.map((g) => g.pluginName)));

    if (enable) {
      for (const pluginName of pluginNames) {
        if (!newSelected.includes(pluginName)) newSelected.push(pluginName);
        const plugin = plugins.find((p) => p.name === pluginName);
        if (!plugin) continue;
        const itemsForPlugin = groupItems.filter((g) => g.pluginName === pluginName).map((g) => g.itemName);
        const current = newExcluded[pluginName] ?? [];
        newExcluded[pluginName] = current.filter((n) => !itemsForPlugin.includes(n));
        for (const name of itemsForPlugin) {
          const it = plugin.items.find((i) => i.name === name);
          if (it && it.dependencies.length > 0) {
            enableDependencies(it, newSelected, newExcluded);
          }
        }
      }
    } else {
      for (const pluginName of pluginNames) {
        const itemsForPlugin = groupItems.filter((g) => g.pluginName === pluginName).map((g) => g.itemName);
        const current = newExcluded[pluginName] ?? [];
        const merged = Array.from(new Set([...current, ...itemsForPlugin]));
        newExcluded[pluginName] = merged;
      }
    }

    setSelectedPlugins(newSelected);
    setExcludedItems(newExcluded);
    markDirty();
  };

  return {
    handleTogglePlugin,
    handleToggleItem,
    handleEnablePluginWithOnly,
    handleToggleGroup,
  };
}
