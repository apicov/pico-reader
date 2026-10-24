"""Email-code sign-in, the same two steps as the tracker app: send a code, verify it."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app import email_service
from app.auth import Reader, create_access_token, find_reader, get_current_reader
from app.db import get_db
from app.verification_codes import store_verification_code, verify_code

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

# One reply whether or not the email is allowed, so the endpoint can't reveal the allowlist
SENT_REPLY = {"message": "If this email can sign in, a code is on its way."}


class SendCodeRequest(BaseModel):
    email: EmailStr


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    reader: Reader


@router.post("/send-code")
def send_code(body: SendCodeRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    if find_reader(db, body.email) is None:
        logger.info("Sign-in code asked for unknown email %s", body.email)
        return SENT_REPLY
    code = email_service.generate_verification_code()
    if not store_verification_code(db, body.email, code):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes requested. Try again in an hour.")
    background.add_task(email_service.send_verification_code, body.email.lower(), code)
    return SENT_REPLY


@router.post("/verify-code", response_model=TokenResponse)
def verify(body: VerifyCodeRequest, db: Session = Depends(get_db)):
    reader = find_reader(db, body.email)
    if reader is None or not verify_code(db, body.email, body.code.strip()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong or expired code")
    return TokenResponse(access_token=create_access_token(reader.email), reader=reader)


@router.get("/me", response_model=Reader)
def me(reader: Reader = Depends(get_current_reader)):
    return reader
