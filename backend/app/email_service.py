"""
Sign-in code emails through Cloudflare Email Sending or Brevo.
Trimmed from tsp-publisher/backend/app/email_service.py (itself from the_stitch_tracker).

  EMAIL_PROVIDER=cloudflare|brevo   (default: cloudflare)
  EMAIL_FALLBACK_PROVIDER=cloudflare|brevo   (optional) — gets every email the main provider couldn't
    send, except when it rejected the address itself
  EMAIL_FROM        — sender address (must be on a domain onboarded with the provider)
  EMAIL_FROM_NAME   — default: Pico Reader

  CLOUDFLARE_EMAIL_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   — Cloudflare
  BREVO_API_KEY                                       — Brevo

DEVELOPMENT MODE: when the main provider's key is missing (and not in production), codes are logged.
"""

import logging
import os
import secrets
import string
from datetime import datetime, timezone

import requests as http

logger = logging.getLogger(__name__)

_KEY_ENV = {"cloudflare": "CLOUDFLARE_EMAIL_API_TOKEN", "brevo": "BREVO_API_KEY"}
_PROVIDER = os.getenv("EMAIL_PROVIDER", "cloudflare").lower()
if _PROVIDER not in _KEY_ENV:
    _PROVIDER = "cloudflare"
_FALLBACK = os.getenv("EMAIL_FALLBACK_PROVIDER", "").strip().lower()
if _FALLBACK == _PROVIDER or _FALLBACK not in _KEY_ENV:
    _FALLBACK = ""

# What a provider did with one email
SENT = "sent"
RETRY = "retry"        # couldn't send now (quota, rate limit, outage, config): another provider may
REJECTED = "rejected"  # refused this address for good: don't try elsewhere


def _from() -> tuple[str, str]:
    return os.getenv("EMAIL_FROM", "noreply@thestitchpatterns.store"), os.getenv("EMAIL_FROM_NAME", "Pico Reader")


def is_production() -> bool:
    from app.config import get_settings

    return "production" in (os.getenv("ENVIRONMENT", "").lower(), get_settings().environment.lower())


def is_development_mode() -> bool:
    return not os.getenv(_KEY_ENV[_PROVIDER], "").strip()


def generate_verification_code(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


def send_verification_code(email: str, code: str) -> bool:
    subject, html = "Your Pico Reader sign-in code", _build_email_html(code)
    if is_development_mode():
        if is_production():
            # Fail closed: a missing key in production must not turn into codes in the log file
            logger.error("Email key %s is not set in production; email to %s NOT sent", _KEY_ENV[_PROVIDER], email)
            return False
        logger.info("EMAIL (development mode) to %s at %s — VERIFICATION CODE: %s",
                    email, datetime.now(timezone.utc).isoformat(), code)
        return True

    outcome = _send_with(_PROVIDER, email, subject, html)
    if outcome == RETRY and _FALLBACK:
        logger.warning("Email to %s not sent via %s; falling back to %s", email, _PROVIDER, _FALLBACK)
        outcome = _send_with(_FALLBACK, email, subject, html)
    return outcome == SENT


def _send_with(provider: str, to: str, subject: str, html: str) -> str:
    return _send_via_brevo(to, subject, html) if provider == "brevo" else _send_via_cloudflare(to, subject, html)


def _status_outcome(status_code: int, body_text: str) -> str:
    """REJECTED only when the provider blames the recipient; anything else may work elsewhere."""
    text = body_text.lower()
    blames_address = any(w in text for w in ("email", "recipient")) and any(
        w in text for w in ("invalid", "not valid", "blocked", "blacklist"))
    return REJECTED if status_code == 400 and blames_address else RETRY


def _send_via_brevo(to: str, subject: str, html: str) -> str:
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        logger.error("BREVO_API_KEY is not set")
        return RETRY
    address, name = _from()
    try:
        resp = http.post("https://api.brevo.com/v3/smtp/email", timeout=10,
                         headers={"api-key": api_key, "Content-Type": "application/json"},
                         json={"sender": {"name": name, "email": address}, "to": [{"email": to}],
                               "subject": subject, "htmlContent": html})
    except Exception as e:  # network error, timeout
        logger.error("Failed to send email via Brevo: %s", e)
        return RETRY
    if not resp.ok:
        logger.error("Brevo email send failed: HTTP %s: %s", resp.status_code, resp.text[:500])
        return _status_outcome(resp.status_code, resp.text)
    logger.info("Email sent via Brevo to %s", to)
    return SENT


def _send_via_cloudflare(to: str, subject: str, html: str) -> str:
    api_token = os.getenv("CLOUDFLARE_EMAIL_API_TOKEN")
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not api_token or not account_id:
        logger.error("CLOUDFLARE_EMAIL_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not set")
        return RETRY
    address, name = _from()
    try:
        resp = http.post(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send", timeout=10,
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
            # The REST API's named-address form is {address, name} (the Workers binding's {email, name} is a 400)
            json={"from": {"address": address, "name": name}, "to": to, "subject": subject, "html": html})
        if not resp.ok:
            logger.error("Cloudflare email send failed: HTTP %s: %s", resp.status_code, resp.text[:500])
            return _status_outcome(resp.status_code, resp.text)
        body = resp.json()
        if not body.get("success"):
            logger.error("Cloudflare email send failed: %s", body.get("errors"))
            return _status_outcome(resp.status_code, str(body.get("errors")))
        if to in ((body.get("result") or {}).get("permanent_bounces") or []):
            logger.error("Cloudflare email to %s permanently bounced", to)
            return REJECTED
        logger.info("Email sent via Cloudflare to %s", to)
        return SENT
    except Exception as e:  # network error, timeout
        logger.error("Failed to send email via Cloudflare: %s", e)
        return RETRY


def _build_email_html(code: str) -> str:
    digits = "".join(
        '<span style="display:inline-block;width:44px;height:52px;line-height:52px;margin:0 3px;'
        'background:#f4f1ea;border:1px solid #cfc8ba;border-radius:6px;font-size:26px;font-weight:600;'
        f'color:#2b2b2b;text-align:center;">{d}</span>'
        for d in code
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:40px 0;background:#faf8f3;font-family:Georgia,serif;color:#2b2b2b;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6e1d6;border-radius:10px;">
      <tr><td style="padding:36px 40px;">
        <p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8a8273;">Pico Reader</p>
        <p style="margin:0 0 28px;font-size:15px;line-height:1.6;">Your sign-in code. It expires in <strong>10 minutes</strong>.</p>
        <div style="text-align:center;margin:0 0 28px;">{digits}</div>
        <p style="margin:0;font-size:13px;color:#8a8273;">If you didn't ask for this code, ignore this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>
"""
