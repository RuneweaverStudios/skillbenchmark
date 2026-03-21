"""
Skill installation for benchmark runs.
Loads skill content and installs it in the appropriate location
depending on the agent loop type.
"""

import json
import os
from pathlib import Path
from typing import Optional


def install_skill(
    skill_content: str,
    skill_format: str,
    agent_loop: str,
    workspace: str = "/workspace",
) -> Optional[str]:
    """
    Install a skill for the benchmark run.

    For Claude CLI: places SKILL.md in .claude/skills/benchmark-skill/
    For API loops: returns the content to append to system prompt
    """
    if agent_loop == "claude_cli":
        return _install_for_claude_cli(skill_content, skill_format, workspace)
    else:
        # For Hermes and Claude API loops, skill is injected into system prompt
        return skill_content


def _install_for_claude_cli(
    skill_content: str,
    skill_format: str,
    workspace: str,
) -> str:
    """Install skill files for Claude CLI agent loop."""
    skill_dir = Path(workspace) / ".claude" / "skills" / "benchmark-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)

    if skill_format == "openclaw":
        # Write _meta.json
        meta_path = skill_dir / "_meta.json"
        meta_path.write_text(skill_content)

        # Also extract SKILL.md if present in the meta
        try:
            meta = json.loads(skill_content)
            if "skillMd" in meta:
                skill_md_path = skill_dir / "SKILL.md"
                skill_md_path.write_text(meta["skillMd"])
        except (json.JSONDecodeError, KeyError):
            pass

        return skill_content
    else:
        # Write SKILL.md
        skill_path = skill_dir / "SKILL.md"
        skill_path.write_text(skill_content)
        return skill_content


def remove_skill(workspace: str = "/workspace") -> None:
    """Remove installed skill (for baseline runs)."""
    skill_dir = Path(workspace) / ".claude" / "skills" / "benchmark-skill"
    if skill_dir.exists():
        import shutil
        shutil.rmtree(skill_dir)
