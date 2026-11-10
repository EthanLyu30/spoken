"""Transactional account messages over HTTPS, with no token in server URLs."""

from urllib.parse import urlencode, urlsplit

import httpx

from app.core.config import get_settings


def email_actions_enabled() -> bool:
    settings = get_settings()
    try:
        origin = urlsplit(settings.account_public_origin)
    except ValueError:
        return False
    return bool(settings.resend_api_key and settings.account_mail_from and origin.scheme == "https"
                and origin.hostname and not (origin.username or origin.password or origin.query or origin.fragment)
                and origin.path in ("", "/"))


def send_account_mail(email: str, kind: str, token: str) -> None:
    settings = get_settings()
    action = "重置密码" if kind == "reset" else "验证邮箱"
    fragment = urlencode({"action": kind, "token": token})
    link = f"{settings.account_public_origin.rstrip('/')}/account-action#{fragment}"
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": settings.account_mail_from, "to": [email], "subject": f"Spoken · {action}",
              "text": f"打开此链接{action}（链接 30 分钟内有效）。\n{link}\n如果这不是你的操作，请忽略此邮件。"},
        timeout=8.0,
    )
    response.raise_for_status()
