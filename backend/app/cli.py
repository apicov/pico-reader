"""Manage who can sign in, from the server shell:

    python -m app.cli add someone@example.com "Their Name" [--admin]
    python -m app.cli remove someone@example.com
    python -m app.cli list

Admins can add books and dictionaries (the desktop tool signs in as one).
"""

import argparse

from sqlalchemy import text

from app.db import get_engine


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add")
    add.add_argument("email")
    add.add_argument("name", nargs="?", default="")
    add.add_argument("--admin", action="store_true")
    sub.add_parser("remove").add_argument("email")
    sub.add_parser("list")
    args = parser.parse_args()

    with get_engine().begin() as conn:
        if args.cmd == "add":
            conn.execute(text("""
                INSERT INTO readers (email, name, is_admin, active) VALUES (:e, :n, :a, true)
                ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, is_admin = EXCLUDED.is_admin, active = true
            """), {"e": args.email.lower().strip(), "n": args.name, "a": args.admin})
            print(f"{args.email} can sign in")
        elif args.cmd == "remove":
            conn.execute(text("UPDATE readers SET active = false WHERE email = :e"), {"e": args.email.lower().strip()})
            print(f"{args.email} can no longer sign in")
        else:
            for row in conn.execute(text("SELECT email, name, is_admin, active FROM readers ORDER BY email")):
                print(f"{row.email:40} {row.name:20} {'admin' if row.is_admin else '':6} {'' if row.active else 'removed'}")


if __name__ == "__main__":
    main()
