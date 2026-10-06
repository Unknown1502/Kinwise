"""Build the AgentCore Runtime code bundle: Linux ARM64 wheels + our source + main.py.

Runs on any OS (including Windows) because uv resolves wheels for the target platform.
Output: agents/concierge/build/package  (consumed by infra via AgentRuntimeArtifact.fromCodeAsset)
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
PKG = BUILD / "package"


def run(*args: str) -> None:
    print("+", " ".join(args))
    subprocess.run(args, check=True, cwd=ROOT)


def main() -> None:
    shutil.rmtree(BUILD, ignore_errors=True)
    PKG.mkdir(parents=True)
    req = BUILD / "requirements.txt"
    run("uv", "export", "--frozen", "--no-dev", "--no-hashes", "--no-emit-project", "-o", str(req))
    run(
        "uv", "pip", "install",
        "-r", str(req),
        "--target", str(PKG),
        "--python-platform", "aarch64-manylinux_2_28",
        "--python-version", "3.12",
        "--only-binary", ":all:",
    )
    shutil.copytree(ROOT / "src" / "kinwise_concierge", PKG / "kinwise_concierge")
    (PKG / "main.py").write_text(
        '"""AgentCore Runtime entry point."""\nfrom kinwise_concierge.app import main\n\nmain()\n', encoding="utf-8"
    )
    for cache in PKG.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    size = sum(f.stat().st_size for f in PKG.rglob("*") if f.is_file()) / 1e6
    print(f"\nBundle ready: {PKG} ({size:.1f} MB)")
    if size > 250:
        sys.exit("Bundle exceeds AgentCore's 250 MB code-asset limit")


if __name__ == "__main__":
    main()
