import { useState, useEffect, useCallback } from "react";
import type { Team } from "../../electron/types";

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await window.api.getTeams();
    setTeams(data);
    setLoading(false);
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

  return { teams, loading, refresh, saveTeam, deleteTeam };
}
