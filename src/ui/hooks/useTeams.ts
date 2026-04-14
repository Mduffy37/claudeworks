import { useState, useEffect, useCallback } from "react";
import type { Team } from "../../electron/types";

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same rationale as useProfiles/usePlugins: without the catch, a rejected
  // getTeams() promise leaves loading=true forever and freezes the splash.
  const refresh = useCallback(async () => {
    try {
      const data = await window.api.getTeams();
      setTeams(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveTeam = useCallback(
    async (team: Team) => {
      const saved = await window.api.saveTeam(team);
      await refresh();
      return saved;
    },
    [refresh]
  );

  const deleteTeam = useCallback(
    async (name: string) => {
      await window.api.deleteTeam(name);
      await refresh();
    },
    [refresh]
  );

  const renameTeam = useCallback(
    async (oldName: string, team: Team) => {
      const saved = await window.api.renameTeam(oldName, team);
      await refresh();
      return saved;
    },
    [refresh]
  );

  return { teams, loading, error, refresh, reload: refresh, saveTeam, deleteTeam, renameTeam };
}
