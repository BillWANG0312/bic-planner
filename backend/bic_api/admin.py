"""Offline account administration. Never accept passwords through arguments."""

import argparse
import getpass
from pathlib import Path
import sys
import warnings

from .db import Database, StorageError
from .security import AuthError, AuthService, canonical_username


class _PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's usual error includes unknown argument values, which might be passwords.
        self.print_usage(sys.stderr)
        self.exit(2, "Invalid command arguments. Use --help for supported options.\n")


def main(argv=None):
    parser = _PrivateArgumentParser(prog="bic-admin", description="Create or disable private BIC accounts offline.")
    parser.add_argument("--database", required=True, type=Path, help="Absolute database path outside the website/source directory")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_PrivateArgumentParser)
    create = commands.add_parser("create-user", help="Prompt securely for a new user's password")
    create.add_argument("username")
    create.add_argument("--role", choices=("student", "advisor"), default="student")
    disable = commands.add_parser("disable-user", help="Disable an account and revoke all its sessions")
    disable.add_argument("username")
    args = parser.parse_args(argv)
    try:
        username = canonical_username(args.username)
        db = Database(args.database)
        if args.command == "create-user":
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                password = getpass.getpass("Password (12-128 characters): ")
                confirmation = getpass.getpass("Confirm password: ")
            if password != confirmation:
                print("Password confirmation did not match; no account was created.", file=sys.stderr)
                return 1
            AuthService(db).create_user(username, password, args.role)
            print("User created.")
        else:
            if not db.disable_user(username):
                print("User not found.", file=sys.stderr)
                return 1
            print("User disabled; existing sessions revoked.")
    except (AuthError, StorageError) as error:
        print(error.message, file=sys.stderr)
        return 1
    except getpass.GetPassWarning:
        print("A terminal with hidden password input is required; no account was created.", file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("Operation cancelled.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
