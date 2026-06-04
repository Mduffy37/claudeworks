import React from "react";
import { useTranslation } from "react-i18next";

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
  placeholder,
}: Props) {
  const { t } = useTranslation(["common"]);

  return (
    <div className="filter-bar">
      <input
        type="text"
        className="filter-bar-search"
        placeholder={placeholder ?? t("common:labels.searchPlugins")}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        className="filter-bar-select"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value as FilterOption)}
        title={t("common:labels.all")}
      >
        <option value="all">{t("common:labels.all")}</option>
        <option value="enabled">{t("common:labels.enabled")}</option>
        <option value="disabled">{t("common:labels.disabled")}</option>
      </select>
      <select
        className="filter-bar-select"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        title={t("common:labels.name")}
      >
        <option value="name">{t("common:labels.name")}</option>
        <option value="source">{t("common:labels.source")}</option>
      </select>
    </div>
  );
}
