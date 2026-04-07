import React, { useState, useMemo } from "react";
import { useProfiles } from "./hooks/useProfiles";
import { usePlugins } from "./hooks/usePlugins";
import { ProfileList } from "./components/ProfileList";
import { ProfileEditor } from "./components/ProfileEditor";
import type { Profile } from "../electron/types";

export function App() {
  const { profiles, loading: profilesLoading, createProfile, updateProfile, deleteProfile } =
    useProfiles();
  const { plugins, loading: pluginsLoading } = usePlugins();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedName) ?? null,
    [profiles, selectedName]
  );

  const handleNew = () => {
    setSelectedName(null);
    setIsCreating(true);
  };

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setIsCreating(false);
  };

  const handleDelete = async (name: string) => {
    await deleteProfile(name);
    if (selectedName === name) {
      setSelectedName(null);
    }
  };

  const handleSave = async (profile: Profile) => {
    if (isCreating) {
      await createProfile(profile);
      setSelectedName(profile.name);
      setIsCreating(false);
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
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" fill="none" />
              <circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,0.9)" />
            </svg>
          </div>
          <span className="app-title-text">Claude Profiles</span>
        </div>
        <ProfileList
          profiles={profiles}
          selectedName={selectedName}
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
          onSave={handleSave}
          onLaunch={handleLaunch}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
