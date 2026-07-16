"""Secure Google Sheets append helper for Stock Check review selections."""
from __future__ import annotations
import json
import re
from urllib.request import Request, urlopen
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from app.config import settings

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _append_via_web_app(category: str, items: list[dict]) -> dict:
    url = settings.google_sheets_web_app_url.strip()
    secret = settings.google_sheets_webhook_secret.strip()
    if not secret:
        raise RuntimeError("GOOGLE_SHEETS_WEBHOOK_SECRET is not configured on Railway")
    payload = json.dumps({"secret": secret, "category": category, "items": items}).encode("utf-8")
    request = Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - configured Apps Script URL
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Google Sheets Web App request failed: {exc}") from exc
    if not result.get("ok"):
        raise RuntimeError(str(result.get("error") or "Google Sheets Web App rejected the request"))
    return {"added": int(result.get("added") or len(items)), "tab": str(result.get("tab") or "")}


def _session() -> AuthorizedSession:
    raw = settings.google_sheets_service_account_json.strip()
    if not raw:
        raise RuntimeError("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not configured on Railway")
    credentials = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
    return AuthorizedSession(credentials)


def _normalize(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _resolve_tab(session: AuthorizedSession, category: str) -> tuple[str, int]:
    spreadsheet_id = settings.stock_spreadsheet_id
    response = session.get(f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?fields=sheets.properties(sheetId,title)", timeout=30)
    response.raise_for_status()
    aliases = ["similar", "silmair"] if category == "similar" else ["fakebarcode", "fakebarcodes"]
    for item in response.json().get("sheets", []):
        properties = item["properties"]
        title = properties["title"]
        normalized = _normalize(title)
        if normalized in aliases or any(alias in normalized for alias in aliases):
            return title, int(properties["sheetId"])
    raise ValueError(f"Could not find {'Similar/Silmair' if category == 'similar' else 'Fake Barcode'} tab")


def _file_date(*urls: object) -> str:
    """Return the image filename date in the same M/D/YYYY style used by the sheet."""
    for value in urls:
        match = re.search(r"(?:^|[^0-9])(20\d{2})[-_](\d{2})[-_](\d{2})(?:[^0-9]|$)", str(value or ""))
        if match:
            year, month, day = match.groups()
            return f"{int(month)}/{int(day)}/{year}"
    return ""


def _percent(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text if text.endswith("%") else f"{text}%"


def _last_saved_date(session: AuthorizedSession, quoted_title: str) -> str:
    response = session.get(
        f"https://sheets.googleapis.com/v4/spreadsheets/{settings.stock_spreadsheet_id}/values/'{quoted_title}'!A:A",
        timeout=30,
    )
    response.raise_for_status()
    for row in reversed(response.json().get("values", [])):
        if row and str(row[0]).strip() and str(row[0]).strip().lower() != "date":
            return str(row[0]).strip()
    return ""


def _with_date_separators(rows: list[list[object]], last_date: str, width: int) -> tuple[list[list[object]], list[int]]:
    output: list[list[object]] = []
    separator_offsets: list[int] = []
    current_date = last_date
    for row in rows:
        row_date = str(row[0] or "").strip()
        if row_date and row_date != current_date:
            separator_offsets.append(len(output))
            output.append([""] * width)
            current_date = row_date
        output.append(row)
    return output, separator_offsets


def _fill_blue_separator_rows(
    session: AuthorizedSession, sheet_id: int, first_row: int,
    offsets: list[int], width: int,
) -> None:
    if not offsets:
        return
    requests = [{"repeatCell": {
        "range": {
            "sheetId": sheet_id, "startRowIndex": first_row - 1 + offset,
            "endRowIndex": first_row + offset, "startColumnIndex": 0,
            "endColumnIndex": width,
        },
        "cell": {"userEnteredFormat": {"backgroundColor": {
            "red": 0.290, "green": 0.525, "blue": 0.910,
        }}},
        "fields": "userEnteredFormat.backgroundColor",
    }} for offset in offsets]
    response = session.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{settings.stock_spreadsheet_id}:batchUpdate",
        json={"requests": requests}, timeout=30,
    )
    response.raise_for_status()


def append_rows(category: str, items: list[dict]) -> dict:
    if category not in {"similar", "fake"}: raise ValueError("category must be similar or fake")
    if settings.google_sheets_web_app_url.strip():
        return _append_via_web_app(category, items)
    session = _session(); title, sheet_id = _resolve_tab(session, category)
    if category == "similar":
        # Existing sheet columns: Date, Image ID, Result Image, Similar Image,
        # Similar Score, Status. Date comes from the checked image filename.
        values = [[
            _file_date(item.get("result_url"), item.get("similar_url")),
            item.get("image_id", ""), item.get("result_url", ""),
            item.get("similar_url", ""), _percent(item.get("csv_score")), "Done",
        ] for item in items]
    else:
        # Existing Fake_Barcode_May columns: Date, Image ID,
        # Fake Barcode Url, Status.
        values = [[
            _file_date(item.get("image_url")), item.get("image_id", ""),
            item.get("image_url", ""), "Done",
        ] for item in items]
    quoted = title.replace("'", "''")
    width = 6 if category == "similar" else 4
    values, separator_offsets = _with_date_separators(
        values, _last_saved_date(session, quoted), width,
    )
    response = session.post(f"https://sheets.googleapis.com/v4/spreadsheets/{settings.stock_spreadsheet_id}/values/'{quoted}'!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", json={"values": values}, timeout=30)
    response.raise_for_status()
    updated_range = response.json().get("updates", {}).get("updatedRange", "")
    row_match = re.search(r"!A(\d+):", updated_range)
    if row_match:
        _fill_blue_separator_rows(session, sheet_id, int(row_match.group(1)), separator_offsets, width)
    return {"added": len(items), "tab": title}
