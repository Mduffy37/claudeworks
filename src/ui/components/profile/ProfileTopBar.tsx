import React from "react";
import { useTranslation } from "react-i18next";
import type { Profile, LaunchOptions } from "../../../electron/types";
import { EditorTopBar, LaunchIcon, shortPath } from "../shared/EditorTopBar";

// Re-export for any external consumers
export { LaunchIcon, shortPath };

// ─── ProfileTopBar ──────────────────────────────────────────────────────────

interface ProfileTopBarProps {
  profile: Profile | null;
  isNew: boolean;
  name: string;
  dirty: boolean;
  saving: boolean;
  saveStatus: "idle" | "saved";
  selectedPlugins: string[];
  directories: string[];
  launchDir: string;
  launching: boolean;
  importedProjectsCount: number;
  onOpenProjectsConfig?: () => void;
  onChangeName: (v: string) => void;
  markDirty: () => void;
  onSetLaunchDir: (dir: string) => void;
  onSetConfirmDelete: (v: boolean) => void;
  onDuplicate?: (name: string) => void;
  onExport?: (name: string) => void;
  onSetOverviewOpen: (v: boolean) => void;
  onSave: () => void;
  onLaunch: () => void;
  onLaunchWithOptions?: (options: LaunchOptions) => void;
}

export function ProfileTopBar({
  profile,
  isNew,
  name,
  dirty,
  saving,
  saveStatus,
  selectedPlugins,
  directories,
  launchDir,
  launching,
  importedProjectsCount,
  onOpenProjectsConfig,
  onChangeName,
  markDirty,
  onSetLaunchDir,
  onSetConfirmDelete,
  onDuplicate,
  onExport,
  onSetOverviewOpen,
  onSave,
  onLaunch,
  onLaunchWithOptions,
}: ProfileTopBarProps) {
  const { t } = useTranslation(["profile", "common"]);
  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? t("profile:topBar.configureSubtitle")
    : enabledCount === 0
    ? t("profile:topBar.noPluginsEnabled")
    : t("profile:topBar.pluginsEnabled", { count: enabledCount });

  const overflowMenu = profile ? (close: () => void) => (
    <>
      {onDuplicate && (
        <button role="menuitem" type="button" onClick={() => { close(); onDuplicate(profile.name); }}>
          {t("profile:topBar.duplicate")}
        </button>
      )}
      {onExport && (
        <button role="menuitem" type="button" onClick={() => { close(); onExport(profile.name); }}>
          {t("profile:topBar.export")}
        </button>
      )}
      <button role="menuitem" type="button" onClick={() => { close(); onSetOverviewOpen(true); }}>
        {t("profile:topBar.overview")}
      </button>
      <div className="pe-overflow-divider" role="separator" />
      <button role="menuitem" type="button" className="pe-overflow-danger" onClick={() => { close(); onSetConfirmDelete(true); }}>
        {t("profile:topBar.delete")}
      </button>
    </>
  ) : undefined;

  return (
    <EditorTopBar
      isNew={isNew}
      name={name}
      dirty={dirty}
      saving={saving}
      saveStatus={saveStatus}
      subtitle={subtitle}
      createLabel={t("profile:topBar.createProfile")}
      namePlaceholder={t("profile:topBar.namePlaceholder")}
      directories={directories}
      launchDir={launchDir}
      launching={launching}
      importedProjectsCount={importedProjectsCount}
      onOpenProjectsConfig={onOpenProjectsConfig}
      onChangeName={onChangeName}
      markDirty={markDirty}
      onSetLaunchDir={onSetLaunchDir}
      onSave={onSave}
      onLaunch={onLaunch}
      onLaunchWithOptions={onLaunchWithOptions}
      launchPopoverProps={{
        defaultDangerous: profile?.launchFlags?.dangerouslySkipPermissions,
        showTmux: false,
      }}
      overflowMenu={overflowMenu}
      onImport={isNew ? async () => {
        const result = await window.api.importProfile();
        if (result.ok && result.profile) {
          if (result.missingPlugins && result.missingPlugins.length > 0) {
            alert(t("profile:topBar.importResult", { name: result.profile.name, count: result.missingPlugins.length, plugins: result.missingPlugins.join("\n") }));
          }
          // Reload will be handled by the parent refreshing
          window.location.reload();
        }
      } : undefined}
    />
  );
}
