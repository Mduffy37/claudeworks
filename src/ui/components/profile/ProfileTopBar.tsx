import React from "react";
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
  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? "Configure plugins and skills for this profile"
    : enabledCount === 0
    ? "No plugins enabled"
    : `${enabledCount} plugin${enabledCount !== 1 ? "s" : ""} enabled`;

  const overflowMenu = profile ? (close: () => void) => (
    <>
      {onDuplicate && (
        <button role="menuitem" type="button" onClick={() => { close(); onDuplicate(profile.name); }}>
          Duplicate
        </button>
      )}
      {onExport && (
        <button role="menuitem" type="button" onClick={() => { close(); onExport(profile.name); }}>
          Export
        </button>
      )}
      <button role="menuitem" type="button" onClick={() => { close(); onSetOverviewOpen(true); }}>
        Overview
      </button>
      <div className="pe-overflow-divider" role="separator" />
      <button role="menuitem" type="button" className="pe-overflow-danger" onClick={() => { close(); onSetConfirmDelete(true); }}>
        Delete Profile
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
      createLabel="Create Profile"
      namePlaceholder="Profile name..."
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
            alert(`Profile imported as "${result.profile.name}".\n\n${result.missingPlugins.length} plugin(s) need installing:\n${result.missingPlugins.join("\n")}\n\nInstall them from Configure Claude > Plugins > Browse.`);
          }
          // Reload will be handled by the parent refreshing
          window.location.reload();
        }
      } : undefined}
    />
  );
}
