import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useProfiles } from "./hooks/useProfiles";
import { usePlugins } from "./hooks/usePlugins";
import { ProfileList } from "./components/ProfileList";
import { ProfileEditor } from "./components/ProfileEditor";
import type { Profile } from "../electron/types";

export function App() {
  const { profiles, loading: profilesLoading, createProfile, updateProfile, deleteProfile, refresh } =
    useProfiles();
  const { plugins, loading: pluginsLoading } = usePlugins();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ type: "select"; name: string } | { type: "new" } | null>(null);
  const [profileHealth, setProfileHealth] = useState<Record<string, string[]>>({});

  const refreshHealth = useCallback(() => {
    window.api.checkProfileHealth().then(setProfileHealth);
  }, []);

  // Refresh health when profiles change
  useEffect(() => {
    if (!profilesLoading) refreshHealth();
  }, [profiles, profilesLoading, refreshHealth]);

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
    } else {
      setSelectedName(null);
      setIsCreating(true);
    }
    setPendingNav(null);
  };

  const handleCancelNav = () => {
    setPendingNav(null);
  };

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

  if (profilesLoading || pluginsLoading) {
    return (
      <div className="app loading">
        <div className="loading-text">Loading plugins…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="drag-bar" />
      <div className="sidebar">
        <div className="app-title">
          <div className="app-title-icon">
            <img src="./logo.svg" alt="" width="240" height="240" />
          </div>
          <span className="app-title-text">Claude Profiles</span>
        </div>
        <ProfileList
          profiles={profiles}
          selectedName={selectedName}
          profileHealth={profileHealth}
          onSelect={handleSelect}
          onNew={handleNew}
          onLaunch={handleLaunch}
        />
      </div>
      <div className="main">
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
                Changes to <strong>{selectedProfile?.name ?? "this profile"}</strong> will be lost if you switch now.
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
