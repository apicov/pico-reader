"""reader login."""

from readertool import client


def register(sub) -> None:
    s = sub.add_parser("login", help="sign in (a code is emailed); adding books needs an admin")
    s.add_argument("email")
    s.add_argument("--server", default=client.DEFAULT_SERVER)
    s.add_argument("--code", help="the code from the email")
    s.set_defaults(run=login)


def login(args) -> None:
    server = args.server.rstrip("/")
    if args.code:
        client.login(server, args.email, args.code.strip())
        print("signed in")
    else:
        client.send_code(server, args.email)
        print(f"If {args.email} can sign in, a code is on its way. Then: reader login {args.email} --code <code>")
