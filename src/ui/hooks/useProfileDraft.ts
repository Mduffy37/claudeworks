import { useState, useEffect, useCallback } from "react";
import type {
  Profile,
  LocalItem,
  StandaloneMcp,
} from "../../../src/electron/types";

type TabId = "plugins" | "skills" | "agents" | "commands" | "mcp" | "local" | "instructions" | "settings";

interface UseProfileDraftArgs {
  profile: Profile | null;
  isNew: boolean;
  onSave: (profile: Profile) => void;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
}

export function useProfileDraft({ profile, isNew, onSave, dirty, onDirtyChange }: UseProfileDraftArgs) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directories, setDirectories] = useState<string[]>([]);
  const [alias, setAlias] = useState("");
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [excludedItems, setExcludedItems] = useState<Record<string, string[]>>({});
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [mcpServers, setMcpServers] = useState<StandaloneMcp[]>([]);
  const [model, setModel] = useState<string>("");
  const [effortLevel, setEffortLevel] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean | undefined>(undefined);
  const [customClaudeMd, setCustomClaudeMd] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("plugins");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchDir, setLaunchDir] = useState("");
  const [binInPath, setBinInPath] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [disabledMcpServers, setDisabledMcpServers] = useState<Record<string, string[]>>({});
  const [launchFlags, setLaunchFlags] = useState<NonNullable<Profile["launchFlags"]>>({});
  const [customFlags, setCustomFlags] = useState("");
  const [useDefaultAuth, setUseDefaultAuth] = useState(true);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [disabledHooks, setDisabledHooks] = useState<Record<string, number[]>>({});
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description,
        directory: directories[0] || undefined,
        directories: directories.length > 0 ? directories : undefined,
        alias: alias.trim() || undefined,
        isDefault: isDefault || undefined,
        plugins: selectedPlugins,
        excludedItems,
        model: (model || undefined) as Profile["model"],
        effortLevel: (effortLevel || undefined) as Profile["effortLevel"],
        voiceEnabled,
        customClaudeMd: customClaudeMd || undefined,
        workflow: workflow.trim() ? workflow : undefined,
        disabledMcpServers: Object.keys(disabledMcpServers).length > 0 ? disabledMcpServers : undefined,
        launchFlags: Object.values(launchFlags).some(Boolean) ? launchFlags : undefined,
        customFlags: customFlags.trim() || undefined,
        useDefaultAuth,
        env: Object.keys(env).length > 0 ? env : undefined,
        disabledHooks: Object.keys(disabledHooks).length > 0 ? disabledHooks : undefined,
      });
      onDirtyChange(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } finally {
      setSaving(false);
    }
  }, [name, description, directories, alias, isDefault, selectedPlugins, excludedItems, model, effortLevel, voiceEnabled, customClaudeMd, workflow, disabledMcpServers, launchFlags, customFlags, useDefaultAuth, env, disabledHooks, onSave, onDirtyChange, saving]);

  // Sync state when profile prop changes
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDescription(profile.description);
      const dirs = profile.directories ?? (profile.directory ? [profile.directory] : []);
      setDirectories(dirs);
      setAlias(profile.alias ?? "");
      setIsDefault(profile.isDefault ?? false);
      setSelectedPlugins([...profile.plugins]);
      setExcludedItems({ ...profile.excludedItems });
      setModel(profile.model ?? "");
      setEffortLevel(profile.effortLevel ?? "");
      setVoiceEnabled(profile.voiceEnabled);
      setCustomClaudeMd(profile.customClaudeMd ?? "");
      setWorkflow(profile.workflow ?? "");
      setDisabledMcpServers(profile.disabledMcpServers ?? {});
      setLaunchFlags(profile.launchFlags ?? {});
      setCustomFlags(profile.customFlags ?? "");
      setUseDefaultAuth(profile.useDefaultAuth !== false);
      setEnv(profile.env ?? {});
      setDisabledHooks(profile.disabledHooks ?? {});
      setLaunchDir(dirs[0] ?? "");
      onDirtyChange(false);
      setOverviewOpen(false);
      setConfirmDelete(false);
    } else if (isNew) {
      setName("");
      setDescription("");
      setDirectories([]);
      setAlias("");
      setIsDefault(false);
      setSelectedPlugins([]);
      setExcludedItems({});
      setLocalItems([]);
      setModel("");
      setEffortLevel("");
      setVoiceEnabled(undefined);
      setCustomClaudeMd("");
      setWorkflow("");
      setDisabledMcpServers({});
      setLaunchFlags({});
      setCustomFlags("");
      setUseDefaultAuth(true);
      setEnv({});
      setDisabledHooks({});
      setLaunchDir("");
      onDirtyChange(false);
      setOverviewOpen(false);
      setConfirmDelete(false);
    }
  }, [profile, isNew, onDirtyChange]);

  // Check if bin dir is in PATH
  useEffect(() => {
    window.api.isBinInPath().then(setBinInPath);
  }, []);

  // Scan local items and MCP servers when selected launch directory or profile changes
  useEffect(() => {
    // Local items: only when a directory is explicitly selected (None = empty)
    if (launchDir) {
      window.api.getLocalItems(launchDir).then(setLocalItems);
    } else {
      setLocalItems([]);
    }
    // MCP servers: fall back to first directory so the MCP tab stays useful for customisation
    const mcpDir = launchDir || directories[0] || "";
    if (mcpDir) {
      window.api.getMcpServers(mcpDir).then(setMcpServers);
    } else {
      window.api.getMcpServers().then(setMcpServers);
    }
  }, [launchDir, directories, profile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        if (name.trim() && dirty) handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [name, dirty, handleSave]);

  const markDirty = () => onDirtyChange(true);

  const handleToggleMcp = (dir: string, mcpName: string, enabled: boolean) => {
    setDisabledMcpServers((prev) => {
      const currentDisabled = prev[dir] ?? [];
      const newDisabled = enabled
        ? currentDisabled.filter((n) => n !== mcpName)  // remove from disabled
        : [...currentDisabled, mcpName];                 // add to disabled
      const result = { ...prev, [dir]: newDisabled };
      if (newDisabled.length === 0) delete result[dir];
      return result;
    });
    markDirty();
  };

  return {
    // State values
    name, setName,
    description, setDescription,
    directories, setDirectories,
    alias, setAlias,
    isDefault, setIsDefault,
    selectedPlugins, setSelectedPlugins,
    excludedItems, setExcludedItems,
    localItems, setLocalItems,
    mcpServers, setMcpServers,
    model, setModel,
    effortLevel, setEffortLevel,
    voiceEnabled, setVoiceEnabled,
    customClaudeMd, setCustomClaudeMd,
    workflow, setWorkflow,
    activeTab, setActiveTab,
    overviewOpen, setOverviewOpen,
    launching, setLaunching,
    launchError, setLaunchError,
    launchDir, setLaunchDir,
    binInPath, setBinInPath,
    confirmDelete, setConfirmDelete,
    disabledMcpServers, setDisabledMcpServers,
    launchFlags, setLaunchFlags,
    customFlags, setCustomFlags,
    useDefaultAuth, setUseDefaultAuth,
    env, setEnv,
    disabledHooks, setDisabledHooks,
    saving,
    saveStatus,
    // Callbacks
    handleSave,
    handleToggleMcp,
    markDirty,
  };
}

export type { TabId };
