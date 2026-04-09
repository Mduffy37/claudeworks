import React, { useState, useMemo } from "react";
import type { AvailablePlugin } from "../../electron/types";

type SortOption = "name" | "popular" | "marketplace";

interface Props {
  plugins: AvailablePlugin[];
  installedIds: Set<string>;
  selectedId: string | null;
  onSelect: (pluginId: string) => void;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function DiscoverList({ plugins, installedIds, selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("popular");

  const filtered = useMemo(() => {
    let result = plugins;
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }
    if (sortBy === "name") result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "popular") result = [...result].sort((a, b) => b.installCount - a.installCount);
    else if (sortBy === "marketplace") result = [...result].sort((a, b) => a.marketplaceName.localeCompare(b.marketplaceName) || a.name.localeCompare(b.name));
    return result;
  }, [plugins, search, sortBy]);

  return (
    <div className="plugin-list-sidebar">
      <div className="pl-search" style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          placeholder="Search available plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-search-input"
          style={{ flex: 1 }}
        />
        <select
          className="pl-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          title="Sort by"
        >
          <option value="popular">Popular</option>
          <option value="name">A-Z</option>
          <option value="marketplace">Source</option>
        </select>
      </div>

      <div className="pl-section">
        {filtered.map((p) => {
          const isInstalled = installedIds.has(p.pluginId);
          return (
            <div
              key={p.pluginId}
              className={`pl-item${p.pluginId === selectedId ? " selected" : ""}${isInstalled ? " installed" : ""}`}
              onClick={() => onSelect(p.pluginId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.pluginId);
                }
              }}
            >
              <div className="pl-item-name">
                {p.name}
                {isInstalled && <span className="default-badge" style={{ background: "var(--text-muted)" }}>Installed</span>}
              </div>
              <div className="pl-item-meta">
                {p.description.length > 60 ? p.description.slice(0, 60) + "..." : p.description}
              </div>
              <div className="pl-item-meta" style={{ fontSize: "0.692rem" }}>
                {formatCount(p.installCount)} installs · {p.marketplaceName.replace("claude-plugins-official", "official")}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-title">{search ? "No matches" : "No plugins available"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
