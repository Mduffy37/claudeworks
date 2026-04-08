import React from "react";

export type SortOption = "name" | "source";
export type FilterOption = "all" | "enabled" | "disabled";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  filter: FilterOption;
  onFilterChange: (v: FilterOption) => void;
  sort: SortOption;
  onSortChange: (v: SortOption) => void;
  placeholder?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  placeholder = "Search...",
}: Props) {
  return (
    <div className="filter-bar">
      <input
        type="text"
        className="filter-bar-search"
        placeholder={placeholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        className="filter-bar-select"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value as FilterOption)}
        title="Filter"
      >
        <option value="all">All</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
      <select
        className="filter-bar-select"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        title="Sort by"
      >
        <option value="name">Name</option>
        <option value="source">Source</option>
      </select>
    </div>
  );
}
