import { useState, useEffect, useCallback } from "react";
import type { Profile } from "../../electron/types";

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // NOTE: the try/catch here is load-bearing. Without it, a rejected
  // getProfiles() promise kills the async function before setLoading(false)
  // runs, leaving App.tsx stuck on the "Loading plugins…" splash forever
  // with no way for the user to recover. The error path sets both
  // loading=false and error=<message> so the UI can transition to the
  // error panel and offer the doctor.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getProfiles();
      setProfiles(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await window.api.getProfiles();
      setProfiles(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  return { profiles, loading, error, refresh, reload: load, createProfile, updateProfile, deleteProfile };
}
