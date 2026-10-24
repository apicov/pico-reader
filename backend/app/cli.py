"""Manage who can sign in, from the server shell:

    python -m app.cli add someone@example.com "Their Name" [--admin]
    python -m app.cli remove someone@example.com
    python -m app.cli list
    python -m app.cli usage [--days 30]      (Groq tokens per reader and purpose)

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
    sub.add_parser("usage").add_argument("--days", type=int, default=30)
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
        elif args.cmd == "usage":
            rows = conn.execute(text("""
                SELECT reader_email, purpose, count(*) AS calls, sum(prompt_tokens) AS i, sum(completion_tokens) AS o
                FROM llm_usage WHERE created_at >= now() - make_interval(days => :d)
                GROUP BY 1, 2 ORDER BY 1, sum(prompt_tokens + completion_tokens) DESC"""), {"d": args.days}).fetchall()
            print(f"Groq tokens, last {args.days} days")
            print(f"{'reader':32} {'purpose':12} {'calls':>6} {'tokens in':>11} {'tokens out':>11}")
            for r in rows:
                print(f"{r.reader_email:32} {r.purpose:12} {r.calls:>6} {r.i:>11,} {r.o:>11,}")
            print(f"{'total':32} {'':12} {sum(r.calls for r in rows):>6} {sum(r.i for r in rows):>11,} {sum(r.o for r in rows):>11,}")
        else:
            for row in conn.execute(text("SELECT email, name, is_admin, active FROM readers ORDER BY email")):
                print(f"{row.email:40} {row.name:20} {'admin' if row.is_admin else '':6} {'' if row.active else 'removed'}")


if __name__ == "__main__":
    main()
