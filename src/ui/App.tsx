import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useProfiles } from "./hooks/useProfiles";
import { usePlugins } from "./hooks/usePlugins";
import { ProfileList } from "./components/ProfileList";
import { ProfileEditor } from "./components/ProfileEditor";
import { PluginList } from "./components/PluginList";
import { PluginManager } from "./components/PluginManager";
import { TeamList } from "./components/TeamList";
import { TeamEditor } from "./components/TeamEditor";
import { useTeams } from "./hooks/useTeams";
import type { Profile, Team } from "../electron/types";

export function App() {
  const { profiles, loading: profilesLoading, createProfile, updateProfile, deleteProfile, refresh } =
    useProfiles();
  const { plugins, loading: pluginsLoading, refresh: refreshPlugins, availableUpdates, checkForUpdates } =
    usePlugins();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ type: "select"; name: string } | { type: "new" } | { type: "tab"; tab: "profiles" | "plugins" | "teams" } | { type: "select-team"; name: string } | { type: "new-team" } | null>(null);
  const [profileHealth, setProfileHealth] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<"profiles" | "plugins" | "teams">("profiles");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const { teams, loading: teamsLoading, refresh: refreshTeams, saveTeam: saveTeamHook, deleteTeam: deleteTeamHook } =
    useTeams();
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

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedName) ?? null,
    [profiles, selectedName]
  );

  const handleNew = () => {
    if (dirty) {
      setPendingNav({ type: "new" });
      return;
    }
    setSelectedName(null);
    setIsCreating(true);
  };

  const handleSelect = (name: string) => {
    if (dirty) {
      setPendingNav({ type: "select", name });
      return;
    }
    setSelectedName(name);
    setIsCreating(false);
  };

  const handleDiscardAndProceed = () => {
    setDirty(false);
    if (!pendingNav) return;
    if (pendingNav.type === "select") {
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
      if (pendingNav.tab === "plugins") checkForUpdates();
    }
    setPendingNav(null);
  };

  const handleCancelNav = () => {
    setPendingNav(null);
  };

  const handleTabSwitch = (tab: "profiles" | "plugins" | "teams") => {
    if (tab === activeTab) return;
    if (dirty) {
      setPendingNav({ type: "tab", tab });
      return;
    }
    setActiveTab(tab);
    if (tab === "plugins") {
      checkForUpdates();
    }
  };

  const handlePluginUpdate = async (name: string) => {
    await window.api.updatePlugin(name);
    refreshPlugins();
    checkForUpdates();
  };

  const handlePluginUninstall = async (name: string) => {
    await window.api.uninstallPlugin(name);
    setSelectedPlugin(null);
    refreshPlugins();
    refreshHealth();
  };

  const handleNavigateToProfile = (profileName: string) => {
    setActiveTab("profiles");
    setSelectedName(profileName);
    setIsCreating(false);
  };

  const handleNewTeam = () => {
    if (dirty) {
      setPendingNav({ type: "new-team" });
      return;
    }
    setSelectedTeamName(null);
    setIsCreatingTeam(true);
  };

  const handleSelectTeam = (name: string) => {
    if (dirty) {
      setPendingNav({ type: "select-team", name });
      return;
    }
    setSelectedTeamName(name);
    setIsCreatingTeam(false);
  };

  const handleSaveTeam = async (team: Team) => {
    if (isCreatingTeam) {
      await saveTeamHook(team);
      setSelectedTeamName(team.name);
      setIsCreatingTeam(false);
    } else if (selectedTeamName && selectedTeamName !== team.name) {
      await window.api.renameTeam(selectedTeamName, team);
      await refreshTeams();
      setSelectedTeamName(team.name);
    } else {
      await saveTeamHook(team);
    }
  };

  const handleDeleteTeam = async (name: string) => {
    await deleteTeamHook(name);
    if (selectedTeamName === name) setSelectedTeamName(null);
  };

  const selectedTeam = useMemo(
    () => teams.find((t) => t.name === selectedTeamName) ?? null,
    [teams, selectedTeamName]
  );

  const selectedPluginData = plugins.find((p) => p.name === selectedPlugin) ?? null;

  const handleDelete = async (name: string) => {
    await deleteProfile(name);
    if (selectedName === name) {
      setSelectedName(null);
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
  };

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
          <span className="drag-bar-title">Claude Profiles</span>
        </div>
      </div>
      <div className="sidebar">
        {/* Tab switcher */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab${activeTab === "profiles" || activeTab === "plugins" ? " active" : ""}`}
            onClick={() => handleTabSwitch("profiles")}
          >
            Profiles
          </button>
          <button
            className={`sidebar-tab${activeTab === "teams" ? " active" : ""}`}
            onClick={() => handleTabSwitch("teams")}
          >
            Teams
          </button>
        </div>
        {activeTab === "profiles" || activeTab === "plugins" ? (
          activeTab === "plugins" ? (
            <PluginList
              plugins={plugins}
              selectedPlugin={selectedPlugin}
              availableUpdates={availableUpdates}
              onSelect={setSelectedPlugin}
            />
          ) : (
            <ProfileList
              profiles={profiles}
              selectedName={selectedName}
              profileHealth={profileHealth}
              onSelect={handleSelect}
              onNew={handleNew}
              onLaunch={handleLaunch}
            />
          )
        ) : (
          <TeamList
            teams={teams}
            selectedTeam={selectedTeamName}
            teamHealth={teamHealth}
            onSelect={handleSelectTeam}
            onNew={handleNewTeam}
          />
        )}
        {(activeTab === "profiles" || activeTab === "plugins") && (
          <button
            className={`sidebar-plugins-btn${activeTab === "plugins" ? " active" : ""}`}
            onClick={() => handleTabSwitch("plugins")}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v6M8 9v6M1 8h6M9 8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Manage Plugins
          </button>
        )}
      </div>
      <div className="main">
        {activeTab === "profiles" ? (
          <ProfileEditor
            profile={selectedProfile}
            plugins={plugins}
            isNew={isCreating}
            brokenPlugins={selectedProfile ? (profileHealth[selectedProfile.name] ?? []) : []}
            onSave={handleSave}
            onLaunch={handleLaunch}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            dirty={dirty}
            onDirtyChange={setDirty}
          />
        ) : activeTab === "plugins" ? (
          <PluginManager
            plugin={selectedPluginData}
            profiles={profiles}
            availableUpdate={selectedPlugin ? (availableUpdates[selectedPlugin] ?? null) : null}
            onUpdate={handlePluginUpdate}
            onUninstall={handlePluginUninstall}
            onNavigateToProfile={handleNavigateToProfile}
          />
        ) : (
          <TeamEditor
            team={selectedTeam}
            profiles={profiles}
            isNew={isCreatingTeam}
            brokenMembers={selectedTeam ? (teamHealth[selectedTeam.name] ?? []) : []}
            onSave={handleSaveTeam}
            onDelete={handleDeleteTeam}
            dirty={dirty}
            onDirtyChange={setDirty}
          />
        )}
      </div>
      {pendingNav && (
        <div className="modal-backdrop" onClick={handleCancelNav}>
          <div className="modal-dialog modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Unsaved Changes</span>
              <button className="modal-close" onClick={handleCancelNav}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Changes to <strong>{activeTab === "teams" ? (selectedTeam?.name ?? "this team") : (selectedProfile?.name ?? "this profile")}</strong> will be lost if you switch now.
              </p>
              <div className="modal-confirm-actions">
                <button className="btn-secondary" onClick={handleCancelNav}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleDiscardAndProceed}>
                  Discard & Switch
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
