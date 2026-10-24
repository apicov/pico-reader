"""JWT tokens for signed-in readers and the FastAPI dependency that checks them.

A token alone is not enough: every request re-checks that the email is still an active
reader, so removing someone from the allowlist locks them out immediately."""

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db

ALGORITHM = "HS256"
security = HTTPBearer()


class Reader(BaseModel):
    email: str
    name: str
    is_admin: bool


def create_access_token(email: str) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.token_days)
    return jwt.encode({"sub": email, "exp": expires}, settings.secret_key, algorithm=ALGORITHM)


def find_reader(db: Session, email: str) -> Reader | None:
    row = db.execute(
        text("SELECT email, name, is_admin FROM readers WHERE email = :e AND active"),
        {"e": email.lower().strip()},
    ).fetchone()
    return Reader(email=row.email, name=row.name, is_admin=row.is_admin) if row else None


def get_current_reader(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Reader:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in",
                                 headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(credentials.credentials, get_settings().secret_key, algorithms=[ALGORITHM])
    except JWTError:
        raise unauthorized
    email = payload.get("sub")
    reader = find_reader(db, email) if email else None
    if reader is None:
        raise unauthorized
    return reader


def get_current_admin(reader: Reader = Depends(get_current_reader)) -> Reader:
    if not reader.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return reader
