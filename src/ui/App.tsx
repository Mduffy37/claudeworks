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
        <div className="loading-text">Loading plugins...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="drag-bar" />
      <div className="sidebar">
        <div className="app-title">Claude Profiles</div>
        <ProfileList
          profiles={profiles}
          selectedName={selectedName}
          onSelect={handleSelect}
          onNew={handleNew}
          onDelete={handleDelete}
        />
      </div>
      <div className="main">
        <ProfileEditor
          profile={selectedProfile}
          plugins={plugins}
          isNew={isCreating}
          onSave={handleSave}
          onLaunch={handleLaunch}
        />
      </div>
    </div>
  );
}
