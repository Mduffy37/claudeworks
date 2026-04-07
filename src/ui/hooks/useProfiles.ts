import { useState, useEffect, useCallback } from "react";
import type { Profile } from "../../electron/types";

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await window.api.getProfiles();
    setProfiles(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProfile = useCallback(
    async (profile: Profile) => {
      const created = await window.api.createProfile(profile);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateProfile = useCallback(
    async (profile: Profile) => {
      const updated = await window.api.updateProfile(profile);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const deleteProfile = useCallback(
    async (name: string) => {
      await window.api.deleteProfile(name);
      await refresh();
    },
    [refresh]
  );

  return { profiles, loading, refresh, createProfile, updateProfile, deleteProfile };
}
