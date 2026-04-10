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
  const [marketplace, setMarketplace] = useState<string>("all");

  const marketplaces = useMemo(() => {
    const names = new Set(plugins.map((p) => p.marketplaceName));
    return [...names].sort();
  }, [plugins]);

  const filtered = useMemo(() => {
    let result = plugins;
    if (marketplace !== "all") {
      result = result.filter((p) => p.marketplaceName === marketplace);
    }
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
  }, [plugins, search, sortBy, marketplace]);

  return (
    <div className="plugin-list-sidebar">
      <div className="pl-search-area">
        <div className="pl-search">
          <input
            type="text"
            placeholder="Search available plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-search-input"
          />
        </div>
        <div className="pl-filters">
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
          <select
            className="pl-sort-select"
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            title="Filter by marketplace"
          >
            <option value="all">All sources</option>
            {marketplaces.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
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
              <div className="pl-item-name">{p.name}</div>
              <div className="pl-item-desc">{p.description}</div>
              <div className="pl-item-meta" style={{ fontSize: "0.692rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {formatCount(p.installCount)} installs
                <span className="discover-marketplace-tag">{p.marketplaceName.replace("claude-plugins-", "")}</span>
                {isInstalled && <span className="default-badge" style={{ background: "var(--text-muted)" }}>Installed</span>}
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
