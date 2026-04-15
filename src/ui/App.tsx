import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ConfirmDialog } from "./components/shared/ConfirmDialog";
import { ManageDialog } from "./components/ManageDialog";
import { BulkManageDialog } from "./components/BulkManageDialog";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { DoctorModal } from "./components/DoctorModal";
import { useProfiles } from "./hooks/useProfiles";
import { usePlugins } from "./hooks/usePlugins";
import { ProfileList } from "./components/ProfileList";
import { ProfileEditor } from "./components/ProfileEditor";
import { TeamList } from "./components/TeamList";
import { TeamEditor } from "./components/TeamEditor";
import { Home } from "./components/Home";
import { useTeams } from "./hooks/useTeams";
import type { Profile, Team } from "../electron/types";

export function App() {
  const { profiles, loading: profilesLoading, error: profilesError, reload: reloadProfiles, createProfile, updateProfile, deleteProfile, refresh } =
    useProfiles();
  const { plugins, loading: pluginsLoading, error: pluginsError, reload: reloadPlugins, refresh: refreshPlugins, availableUpdates, checkForUpdates } =
    usePlugins();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ type: "select"; name: string } | { type: "new" } | { type: "tab"; tab: "profiles" | "teams" } | { type: "select-team"; name: string } | { type: "new-team" } | null>(null);
  const [profileHealth, setProfileHealth] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<"profiles" | "teams">("profiles");
  const [showHome, setShowHome] = useState(true);
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [manageDialogInitialTab, setManageDialogInitialTab] = useState<"plugins" | "projects" | "prompts" | "global" | "health" | "statusbar" | undefined>(undefined);
  const [focusTagsSignal, setFocusTagsSignal] = useState(0);
  const [focusProjectsSignal, setFocusProjectsSignal] = useState(0);
  const [showBulkManage, setShowBulkManage] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [importedProjects, setImportedProjects] = useState<string[]>([]);
  const editorSaveRef = useRef<(() => Promise<void> | void) | null>(null);
  const { teams, loading: teamsLoading, error: teamsError, reload: reloadTeams, refresh: refreshTeams, saveTeam: saveTeamHook, deleteTeam: deleteTeamHook, renameTeam: renameTeamHook } =
    useTeams();
  const [showDoctor, setShowDoctor] = useState(false);
  // Whether the doctor was opened from the error panel (hung splash) vs
  // proactively from App Settings. Only affects the modal's header copy.
  const [doctorFromError, setDoctorFromError] = useState(false);
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [teamHealth, setTeamHealth] = useState<Record<string, string[]>>({});

  const refreshHealth = useCallback(() => {
    window.api.checkProfileHealth().then(setProfileHealth);
  }, []);

  const refreshTeamHealth = useCallback(() => {
    window.api.checkTeamHealth().then(setTeamHealth);
  }, []);

  // Refresh health when profiles change
  useEffect(() => {
    if (!profilesLoading) refreshHealth();
  }, [profiles, profilesLoading, refreshHealth]);

  useEffect(() => {
    if (!teamsLoading) refreshTeamHealth();
  }, [teams, teamsLoading, refreshTeamHealth]);

  const handleCloseManageDialog = useCallback(() => {
    setShowManageDialog(false);
    setManageDialogInitialTab(undefined);
    window.api.getImportedProjects().then(setImportedProjects);
  }, []);

  const openProjectsConfig = useCallback(() => {
    setManageDialogInitialTab("projects");
    setShowManageDialog(true);
  }, []);

  const requestFocusTagsOnSelected = useCallback(() => {
    setFocusTagsSignal((n) => n + 1);
  }, []);

  const requestFocusProjectsOnSelected = useCallback(() => {
    if (importedProjects.length === 0) {
      openProjectsConfig();
      return;
    }
    setFocusProjectsSignal((n) => n + 1);
  }, [importedProjects.length, openProjectsConfig]);

  // Load imported projects
  const refreshImportedProjects = useCallback(() => {
    window.api.getImportedProjects().then(setImportedProjects);
  }, []);

  // Bumped on every hard refresh so nested dialogs (like ManageDialog) know
  // the main-process curated caches have been invalidated and they should
  // re-read. Without this, ManageDialog's local `curatedIndex` state stays
  // stale even after core.ts has a fresh cache.
  const [curatedRefreshKey, setCuratedRefreshKey] = useState(0);

  const handleHardRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(refreshPlugins()),
        Promise.resolve(refresh()),
        Promise.resolve(refreshTeams()),
        Promise.resolve(refreshHealth()),
        Promise.resolve(refreshTeamHealth()),
        Promise.resolve(refreshImportedProjects()),
        window.api.refreshCuratedMarketplace().catch(() => undefined),
        window.api.refreshCuratedIndex().catch(() => undefined),
      ]);
      setCuratedRefreshKey((k) => k + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshPlugins, refresh, refreshTeams, refreshHealth, refreshTeamHealth, refreshImportedProjects]);

  useEffect(() => {
    refreshImportedProjects();
    // Apply saved preferences
    window.api.getAppPreferences().then((p) => {
      const scale = p.fontSize ?? 1;
      if (scale !== 1) document.documentElement.style.fontSize = `${13 * scale}px`;
      const theme = p.theme ?? "dark";
      const resolved = theme === "auto"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      document.documentElement.setAttribute("data-theme", resolved);
      // Listen for system changes if auto
      if (theme === "auto") {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
          document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
        });
      }
    });
  }, [refreshImportedProjects]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedName) ?? null,
    [profiles, selectedName]
  );

  const hasDefaultProfile = useMemo(
    () => profiles.some((p) => p.isDefault),
    [profiles]
  );

  // Skip dirty guard for brand-new profiles/teams with no name entered
  const shouldGuard = dirty && !(isCreating && !selectedName) && !(isCreatingTeam && !selectedTeamName);

  const handleNew = () => {
    if (shouldGuard) {
      setPendingNav({ type: "new" });
      return;
    }
    setDirty(false);
    setSelectedName(null);
    setIsCreating(true);
    setShowHome(false);
  };

  const handleSelect = (name: string) => {
    if (shouldGuard) {
      setPendingNav({ type: "select", name });
      return;
    }
    setDirty(false);
    setSelectedName(name);
    setIsCreating(false);
    setShowHome(false);
  };

  const handleDiscardAndProceed = () => {
    setDirty(false);
    if (!pendingNav) return;
    if (pendingNav.type === "select") {
      setActiveTab("profiles");
      setSelectedName(pendingNav.name);
      setIsCreating(false);
    } else if (pendingNav.type === "new") {
      setSelectedName(null);
      setIsCreating(true);
    } else if (pendingNav.type === "select-team") {
      setSelectedTeamName(pendingNav.name);
      setIsCreatingTeam(false);
    } else if (pendingNav.type === "new-team") {
      setSelectedTeamName(null);
      setIsCreatingTeam(true);
    } else if (pendingNav.type === "tab") {
      setActiveTab(pendingNav.tab);
    }
    setPendingNav(null);
  };

  const handleCancelNav = () => {
    setPendingNav(null);
  };

  const handleSaveAndProceed = async () => {
    if (editorSaveRef.current) {
      await editorSaveRef.current();
    }
    setDirty(false);
    handleDiscardAndProceed();
  };

  const handleTabSwitch = (tab: "profiles" | "teams") => {
    if (tab === activeTab) return;
    if (shouldGuard) {
      setPendingNav({ type: "tab", tab });
      return;
    }
    setActiveTab(tab);
  };

  const handlePluginUpdate = async (name: string) => {
    await window.api.updatePlugin(name);
    refreshPlugins();
    checkForUpdates();
  };

  const handlePluginUninstall = async (name: string) => {
    await window.api.uninstallPlugin(name);
    refreshPlugins();
    refreshHealth();
  };

  const handleNavigateToProfile = (profileName: string) => {
    if (shouldGuard) {
      setPendingNav({ type: "select", name: profileName });
      return;
    }
    setActiveTab("profiles");
    setSelectedName(profileName);
    setIsCreating(false);
  };

  const handleToggleProfileFavourite = async (name: string) => {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) return;
    await updateProfile({ ...profile, favourite: !profile.favourite });
  };

  const handleToggleTeamFavourite = async (name: string) => {
    const team = teams.find((t) => t.name === name);
    if (!team) return;
    await saveTeamHook({ ...team, favourite: !team.favourite });
  };

  const handleCreateDefault = async () => {
    const defaultProfile: Profile = {
      name: "Default",
      plugins: [],
      excludedItems: {},
      description: "Your default profile. Running `claude` launches with these plugins and settings.",
      isDefault: true,
      alias: "claude",
      useDefaultAuth: true,
    };
    await createProfile(defaultProfile);
    setShowManageDialog(false);
    setSelectedName("Default");
    setIsCreating(false);
  };

  const handleNewTeam = () => {
    if (shouldGuard) {
      setPendingNav({ type: "new-team" });
      return;
    }
    setSelectedTeamName(null);
    setIsCreatingTeam(true);
    setShowHome(false);
  };

  const handleSelectTeam = (name: string) => {
    if (shouldGuard) {
      setPendingNav({ type: "select-team", name });
      return;
    }
    setSelectedTeamName(name);
    setIsCreatingTeam(false);
    setShowHome(false);
  };

  const handleSaveTeam = async (team: Team) => {
    if (isCreatingTeam) {
      await saveTeamHook(team);
      setSelectedTeamName(team.name);
      setIsCreatingTeam(false);
    } else if (selectedTeamName && selectedTeamName !== team.name) {
      await renameTeamHook(selectedTeamName, team);
      setSelectedTeamName(team.name);
    } else {
      await saveTeamHook(team);
    }
  };

  const handleDeleteTeam = async (name: string) => {
    try {
      await deleteTeamHook(name);
      if (selectedTeamName === name) setSelectedTeamName(null);
    } catch (err: any) {
      console.error("Delete team failed:", err);
    }
  };

  const selectedTeam = useMemo(
    () => teams.find((t) => t.name === selectedTeamName) ?? null,
    [teams, selectedTeamName]
  );

  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) for (const t of p.tags ?? []) set.add(t);
    for (const t of teams) for (const tag of t.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [profiles, teams]);

  const handleDelete = async (name: string) => {
    try {
      await deleteProfile(name);
      if (selectedName === name) setSelectedName(null);
    } catch (err: any) {
      console.error("Delete failed:", err);
    }
  };

  const handleDuplicate = async (name: string) => {
    const copy = await window.api.duplicateProfile(name);
    await refresh();
    setDirty(false);
    setSelectedName(copy.name);
    setIsCreating(false);
  };

  const handleSave = async (profile: Profile) => {
    if (isCreating) {
      await createProfile(profile);
      setSelectedName(profile.name);
      setIsCreating(false);
    } else if (selectedName && selectedName !== profile.name) {
      await window.api.renameProfile(selectedName, profile);
      await refresh();
      setSelectedName(profile.name);
    } else {
      await updateProfile(profile);
    }
  };

  const handleLaunch = async (name: string, directory?: string) => {
    await window.api.launchProfile(name, directory);
    await refresh();
  };

  // Reload all three load hooks in parallel. Called after the doctor
  // finishes a repair so the main UI re-fetches against the healed store.
  const reloadAllStores = () => {
    reloadProfiles();
    reloadPlugins();
    reloadTeams();
    setShowDoctor(false);
    setDoctorFromError(false);
  };

  // Errors take precedence over loading — if any hook rejected, transition
  // straight to the error panel instead of leaving the splash up. Without
  // this branch the user has no way to recover from a bad profiles.json.
  const loadErrors = [
    profilesError && { source: "profiles.json", message: profilesError },
    pluginsError && { source: "plugins", message: pluginsError },
    teamsError && { source: "teams.json", message: teamsError },
  ].filter(Boolean) as Array<{ source: string; message: string }>;

  if (loadErrors.length > 0) {
    return (
      <div className="app loading">
        <div className="app-error-panel">
          <div className="app-error-icon" aria-hidden>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 4l14 24H2L16 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M16 13v7M16 23v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div className="app-error-title">Claude Profiles couldn't load</div>
          <div className="app-error-subtitle">
            One or more config files failed to read. Run the Profiles Doctor to find and repair known issues.
          </div>
          <ul className="app-error-sources">
            {loadErrors.map((e, i) => (
              <li key={i}>
                <strong>{e.source}</strong>: {e.message}
              </li>
            ))}
          </ul>
          <div className="app-error-actions">
            <button
              className="btn-primary"
              onClick={() => {
                setDoctorFromError(true);
                setShowDoctor(true);
              }}
            >
              Run Profiles Doctor
            </button>
            <button className="btn-secondary" onClick={reloadAllStores}>
              Retry
            </button>
          </div>
        </div>
        {showDoctor && (
          <DoctorModal
            fromErrorState={doctorFromError}
            onReload={reloadAllStores}
            onClose={() => setShowDoctor(false)}
          />
        )}
      </div>
    );
  }

  if (profilesLoading || pluginsLoading || teamsLoading) {
    return (
      <div className="app loading">
        <div className="loading-text">Loading plugins…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="drag-bar">
        <div className="drag-bar-brand">
          <img src="./logo.svg" alt="" width="16" height="16" className="drag-bar-logo" />
          <h1 className="drag-bar-title">Claude Profiles</h1>
        </div>
        <button
          className="app-refresh-btn"
          onClick={handleHardRefresh}
          disabled={isRefreshing}
          title="Reload all plugins, profiles, and teams from disk"
        >
          <svg
            className={`refresh-icon${isRefreshing ? " spinning" : ""}`}
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="app-settings-btn" onClick={() => setShowAppSettings(true)} title="App Settings">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M6.5 1.5h3L10 3.4a5 5 0 011.2.7l1.8-.7 1.5 2.6-1.3 1.3a5 5 0 010 1.4l1.3 1.3-1.5 2.6-1.8-.7a5 5 0 01-1.2.7l-.5 1.9h-3L6 12.6a5 5 0 01-1.2-.7l-1.8.7L1.5 10l1.3-1.3a5 5 0 010-1.4L1.5 6l1.5-2.6 1.8.7A5 5 0 016 3.4l.5-1.9z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
      <div className="sidebar">
        {/* Tab switcher */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-home-btn${showHome ? " active" : ""}`}
            onClick={() => setShowHome(true)}
            title="Home"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 8.5L8 3l6 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.5 9.5V14h3.5v-3h2v3H12.5V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className={`sidebar-tab${activeTab === "profiles" && !showHome ? " active" : ""}`}
            onClick={() => { handleTabSwitch("profiles"); setShowHome(false); }}
          >
            Profiles
          </button>
          <button
            className={`sidebar-tab${activeTab === "teams" && !showHome ? " active" : ""}`}
            onClick={() => { handleTabSwitch("teams"); setShowHome(false); }}
          >
            Teams
          </button>
        </div>
        {activeTab === "profiles" ? (
          <ProfileList
            profiles={profiles}
            selectedName={selectedName}
            profileHealth={profileHealth}
            importedProjects={importedProjects}
            onSelect={handleSelect}
            onNew={handleNew}
            onLaunch={handleLaunch}
            onSave={() => editorSaveRef.current?.()}
            dirty={dirty}
            onToggleFavourite={handleToggleProfileFavourite}
            onOpenProjectsConfig={openProjectsConfig}
            onRequestFocusTagsOnSelected={requestFocusTagsOnSelected}
            onRequestFocusProjectsOnSelected={requestFocusProjectsOnSelected}
          />
        ) : (
          <TeamList
            teams={teams}
            selectedTeam={selectedTeamName}
            teamHealth={teamHealth}
            importedProjects={importedProjects}
            onSelect={handleSelectTeam}
            onNew={handleNewTeam}
            onToggleFavourite={handleToggleTeamFavourite}
            onOpenProjectsConfig={openProjectsConfig}
            onRequestFocusTagsOnSelected={requestFocusTagsOnSelected}
            onRequestFocusProjectsOnSelected={requestFocusProjectsOnSelected}
          />
        )}
        <div className="sidebar-dock">
          <button
            className="sidebar-dock-action"
            onClick={() => setShowBulkManage(true)}
            title={activeTab === "profiles" ? "Manage Profiles" : "Manage Teams"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="sidebar-dock-label">
              {activeTab === "profiles" ? "Manage" : "Manage"}
            </span>
          </button>
          <div className="sidebar-dock-divider" />
          <button
            className="sidebar-dock-primary"
            onClick={() => { checkForUpdates(); setShowManageDialog(true); }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 1.5h3L10 3.4a5 5 0 011.2.7l1.8-.7 1.5 2.6-1.3 1.3a5 5 0 010 1.4l1.3 1.3-1.5 2.6-1.8-.7a5 5 0 01-1.2.7l-.5 1.9h-3L6 12.6a5 5 0 01-1.2-.7l-1.8.7L1.5 10l1.3-1.3a5 5 0 010-1.4L1.5 6l1.5-2.6 1.8.7A5 5 0 016 3.4l.5-1.9z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            Configure Claude
          </button>
        </div>
      </div>
      <div className="main">
        {showHome ? (
          <Home
            profiles={profiles}
            onSelectProfile={(name) => {
              setActiveTab("profiles");
              handleSelect(name);
            }}
            onLaunch={handleLaunch}
          />
        ) : activeTab === "profiles" ? (
          <ProfileEditor
            profile={selectedProfile}
            plugins={plugins}
            isNew={isCreating}
            brokenPlugins={selectedProfile ? (profileHealth[selectedProfile.name] ?? []) : []}
            importedProjects={importedProjects}
            tagSuggestions={tagSuggestions}
            onSave={handleSave}
            onLaunch={handleLaunch}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onOpenProjectsConfig={openProjectsConfig}
            focusTagsSignal={focusTagsSignal}
            focusProjectsSignal={focusProjectsSignal}
            dirty={dirty}
            onDirtyChange={setDirty}
            onRegisterSave={(fn) => { editorSaveRef.current = fn; }}
          />
        ) : (
          <TeamEditor
            team={selectedTeam}
            profiles={profiles}
            isNew={isCreatingTeam}
            brokenMembers={selectedTeam ? (teamHealth[selectedTeam.name] ?? []) : []}
            importedProjects={importedProjects}
            tagSuggestions={tagSuggestions}
            onSave={handleSaveTeam}
            onDelete={handleDeleteTeam}
            onLaunch={handleLaunch}
            onOpenProjectsConfig={openProjectsConfig}
            focusTagsSignal={focusTagsSignal}
            focusProjectsSignal={focusProjectsSignal}
            dirty={dirty}
            onDirtyChange={setDirty}
            onNavigateToProfile={handleNavigateToProfile}
          />
        )}
      </div>
      {showManageDialog && (
        <ManageDialog
          plugins={plugins}
          profiles={profiles}
          availableUpdates={availableUpdates}
          hasDefaultProfile={hasDefaultProfile}
          initialTab={manageDialogInitialTab}
          onUpdate={handlePluginUpdate}
          onUninstall={handlePluginUninstall}
          onNavigateToProfile={handleNavigateToProfile}
          onCreateDefault={handleCreateDefault}
          onClose={handleCloseManageDialog}
          onPluginsChanged={refreshPlugins}
          curatedRefreshKey={curatedRefreshKey}
        />
      )}
      {showBulkManage && (
        <BulkManageDialog
          profiles={profiles}
          teams={teams}
          plugins={plugins}
          importedProjects={importedProjects}
          defaultTab={activeTab}
          onUpdateProfile={async (p) => { await updateProfile(p); }}
          onDeleteProfile={async (name) => {
            await deleteProfile(name);
            if (selectedName === name) setSelectedName(null);
          }}
          onUpdateTeam={async (t) => { await saveTeamHook(t); }}
          onDeleteTeam={async (name) => {
            await deleteTeamHook(name);
            if (selectedTeamName === name) setSelectedTeamName(null);
          }}
          onClose={() => setShowBulkManage(false)}
        />
      )}
      {showAppSettings && (
        <AppSettingsDialog
          onClose={() => setShowAppSettings(false)}
          onOpenDoctor={() => {
            setShowAppSettings(false);
            setDoctorFromError(false);
            setShowDoctor(true);
          }}
        />
      )}
      {showDoctor && (
        <DoctorModal
          fromErrorState={doctorFromError}
          onReload={reloadAllStores}
          onClose={() => setShowDoctor(false)}
        />
      )}
      {pendingNav && (
        <ConfirmDialog
          title="Unsaved Changes"
          description={<>Changes to <strong>{activeTab === "teams" ? (selectedTeam?.name ?? "this team") : (selectedProfile?.name ?? "this profile")}</strong> will be lost if you switch now.</>}
          confirmLabel="Discard & Switch"
          onConfirm={handleDiscardAndProceed}
          onCancel={handleCancelNav}
          extraLabel="Save & Switch"
          onExtra={handleSaveAndProceed}
        />
      )}
    </div>
  );
}
