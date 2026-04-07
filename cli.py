#!/usr/bin/env python3
"""
Quick CLI for testing profile assembly.

Usage:
    python cli.py scan                          # List all installed plugins and their items
    python cli.py create <name> <plugins...>    # Create a profile with selected plugins
    python cli.py launch <name> [directory]     # Launch a profile in iTerm2
    python cli.py list                          # List existing profiles
    python cli.py delete <name>                 # Delete a profile
"""

import sys
import shutil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from core import (
    Profile,
    scan_installed_plugins,
    scan_plugin_items,
    assemble_profile,
    copy_credentials,
    launch_profile,
    PROFILES_DIR,
)


def cmd_scan():
    """Show all installed plugins and their contents."""
    plugins = scan_installed_plugins()
    for plugin in plugins:
        items = scan_plugin_items(plugin)
        skills = [i for i in items if i.type == "skill"]
        agents = [i for i in items if i.type == "agent"]
        commands = [i for i in items if i.type == "command"]

        print(f"\n{plugin.name} (scope: {plugin.scope}, v{plugin.version})")
        if skills:
            for s in skills:
                invocable = "" if s.user_invocable else " [internal]"
                print(f"  skill: {s.name}{invocable}")
        if agents:
            for a in agents:
                print(f"  agent: {a.name}")
        if commands:
            for c in commands:
                print(f"  command: /{c.name}")
        if not (skills or agents or commands):
            print("  (no skills/agents/commands found)")


def cmd_create(name: str, plugin_names: list[str]):
    """Create and assemble a profile."""
    profile = Profile(name=name, plugins=plugin_names)

    print(f"Creating profile '{name}' with {len(plugin_names)} plugins...")
    config_dir = assemble_profile(profile)
    print(f"  Config dir: {config_dir}")

    print("Copying credentials...")
    if copy_credentials(profile):
        print(f"  Keychain: {profile.keychain_service}")
    else:
        print("  WARNING: Could not copy credentials. Run /login in the profile session.")

    print(f"\nProfile '{name}' ready. Launch with:")
    print(f"  python cli.py launch {name}")
    print(f"  # or manually:")
    print(f"  CLAUDE_CONFIG_DIR={config_dir} claude")


def cmd_launch(name: str, directory: str | None = None):
    """Launch a profile in iTerm2."""
    profile = Profile(name=name)
    if not profile.config_dir.exists():
        print(f"Profile '{name}' not found. Create it first.")
        sys.exit(1)

    print(f"Launching profile '{name}'...")
    launch_profile(profile, directory)
    print("Opened in iTerm2.")


def cmd_list():
    """List existing profiles."""
    if not PROFILES_DIR.exists():
        print("No profiles yet.")
        return

    for p in sorted(PROFILES_DIR.iterdir()):
        if p.is_dir() and (p / "config").exists():
            # Count plugins
            manifest = p / "config" / "plugins" / "installed_plugins.json"
            count = 0
            if manifest.exists():
                import json
                with open(manifest) as f:
                    data = json.load(f)
                count = len(data.get("plugins", {}))
            print(f"  {p.name}: {count} plugins")


def cmd_delete(name: str):
    """Delete a profile directory."""
    profile_dir = PROFILES_DIR / name
    if not profile_dir.exists():
        print(f"Profile '{name}' not found.")
        sys.exit(1)

    # Also clean up keychain
    profile = Profile(name=name)
    import subprocess, os
    username = os.environ.get("USER", "unknown")
    subprocess.run(
        ["security", "delete-generic-password", "-s", profile.keychain_service, "-a", username],
        capture_output=True, check=False,
    )

    shutil.rmtree(profile_dir)
    print(f"Deleted profile '{name}'.")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "scan":
        cmd_scan()
    elif cmd == "create":
        if len(sys.argv) < 4:
            print("Usage: python cli.py create <name> <plugin1> [plugin2] ...")
            sys.exit(1)
        cmd_create(sys.argv[2], sys.argv[3:])
    elif cmd == "launch":
        directory = sys.argv[3] if len(sys.argv) > 3 else None
        cmd_launch(sys.argv[2], directory)
    elif cmd == "list":
        cmd_list()
    elif cmd == "delete":
        if len(sys.argv) < 3:
            print("Usage: python cli.py delete <name>")
            sys.exit(1)
        cmd_delete(sys.argv[2])
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
