"""`reader sync --install`: a systemd user service that keeps `reader sync` running (starts with the session,
restarts after a failure)."""

import os
import subprocess
from pathlib import Path

SERVICE = "pico-reader-sync.service"


def _unit() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user" / SERVICE


def service_installed() -> bool:
    return _unit().exists()


def _unit_arg(value: object) -> str:
    """One argument on a systemd ExecStart line, quoted (a folder may have spaces, % and $ mean something there)."""
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$")
    return f'"{escaped}"'


def install(folder: Path, interval: float) -> None:
    """A systemd user service: starts with the session, restarts after a failure."""
    reader = Path(__file__).resolve().parent.parent / "reader"
    unit = _unit()
    unit.parent.mkdir(parents=True, exist_ok=True)
    unit.write_text(f"""[Unit]
Description=Pico Reader: sync the study computer's folder with the app
After=network-online.target

[Service]
ExecStart={_unit_arg(reader)} sync --folder {_unit_arg(folder.expanduser())} --interval {interval:g}
Environment=PYTHONUNBUFFERED=1
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
""")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", SERVICE], check=True)
    print(f"installed {unit}; logs: journalctl --user -u {SERVICE} -f")


def uninstall() -> None:
    unit = _unit()
    subprocess.run(["systemctl", "--user", "disable", "--now", SERVICE], check=False)
    unit.unlink(missing_ok=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    print("removed the sync service")
