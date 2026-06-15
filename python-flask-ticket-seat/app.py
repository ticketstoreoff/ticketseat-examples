import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "ticket-seat-local-demo")

TICKET_SEAT_API_BASE_URL = os.getenv(
    "TICKET_SEAT_API_BASE_URL",
    "https://perceptive-heart-production.up.railway.app/api/v1",
).rstrip("/")
TICKET_SEAT_PARTNER_TOKEN = os.getenv("TICKET_SEAT_PARTNER_TOKEN", "")
TICKET_SEAT_WEBHOOK_SECRET = os.getenv("TICKET_SEAT_WEBHOOK_SECRET", "")

WEBHOOK_EVENTS: list[dict[str, Any]] = []
BASE_DIR = Path(__file__).resolve().parent


class TicketSeatError(Exception):
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self.payload = payload
        super().__init__(str(payload))


def ticket_seat_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {TICKET_SEAT_PARTNER_TOKEN}",
        "Accept": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def ticket_seat_request(method: str, path: str, **kwargs: Any) -> Any:
    if not TICKET_SEAT_PARTNER_TOKEN:
        raise TicketSeatError(
            500,
            {
                "error": "TICKET_SEAT_PARTNER_TOKEN manquant",
                "hint": "Renseigne le token dans le fichier .env",
            },
        )

    url = f"{TICKET_SEAT_API_BASE_URL}{path}"
    response = requests.request(method, url, timeout=20, **kwargs)
    try:
        payload = response.json()
    except ValueError:
        payload = {"raw": response.text}

    if response.status_code >= 400:
        raise TicketSeatError(response.status_code, payload)
    return payload


def json_error(error: Exception):
    if isinstance(error, TicketSeatError):
        return jsonify(error.payload), error.status_code
    return jsonify({"error": str(error)}), 500


def normalize_selection(selection: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in selection:
        seat_id = item.get("id") or item.get("seatId")
        if not seat_id:
            continue
        price = item.get("price")
        normalized.append(
            {
                "type": "SEAT",
                "id": str(seat_id),
                "label": item.get("label") or item.get("seatLabel") or str(seat_id),
                "price": int(price) if isinstance(price, (int, float)) else 0,
                "currency": item.get("currency") or "XOF",
            }
        )
    return normalized


def sign_payload(timestamp: str, raw_body: bytes) -> str:
    return hmac.new(
        TICKET_SEAT_WEBHOOK_SECRET.encode("utf-8"),
        timestamp.encode("utf-8") + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()


def verify_webhook_signature(raw_body: bytes) -> tuple[bool, str]:
    if not TICKET_SEAT_WEBHOOK_SECRET:
        return True, "Secret absent : verification ignoree en demo"

    timestamp = request.headers.get("x-ticket-store-timestamp", "")
    signature = request.headers.get("x-ticket-store-signature", "")
    if not timestamp or not signature:
        return False, "Headers de signature manquants"

    expected = sign_payload(timestamp, raw_body)
    if not hmac.compare_digest(expected, signature):
        return False, "Signature invalide"
    return True, "Signature valide"


@app.get("/")
def index():
    return render_template(
        "index.html",
        api_base_url=TICKET_SEAT_API_BASE_URL,
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/source-bundle")
def api_source_bundle():
    files = {
        "html": BASE_DIR / "templates" / "index.html",
        "js": BASE_DIR / "static" / "app.js",
        "css": BASE_DIR / "static" / "app.css",
    }
    return jsonify(
        {
            key: path.read_text(encoding="utf-8")
            for key, path in files.items()
        }
    )


@app.get("/api/events")
def api_events():
    try:
        return jsonify(ticket_seat_request("GET", "/partner/events", headers=ticket_seat_headers()))
    except Exception as error:
        return json_error(error)


@app.get("/api/events/<event_id>/showtimes")
def api_showtimes(event_id: str):
    try:
        return jsonify(
            ticket_seat_request(
                "GET",
                f"/partner/events/{event_id}/showtimes",
                headers=ticket_seat_headers(),
            )
        )
    except Exception as error:
        return json_error(error)


@app.get("/api/events/<event_id>/embed")
def api_event_embed(event_id: str):
    try:
        return jsonify(
            ticket_seat_request(
                "GET",
                f"/partner/events/{event_id}/embed",
                headers=ticket_seat_headers(),
            )
        )
    except Exception as error:
        return json_error(error)


@app.get("/api/showtimes/<showtime_id>/embed")
def api_showtime_embed(showtime_id: str):
    try:
        return jsonify(
            ticket_seat_request(
                "GET",
                f"/partner/showtimes/{showtime_id}/embed",
                headers=ticket_seat_headers(),
            )
        )
    except Exception as error:
        return json_error(error)


@app.post("/api/holds")
def api_create_hold():
    try:
        data = request.get_json(force=True)
        selection = normalize_selection(data.get("selection", []))
        payload = {
            "layoutId": data["layoutId"],
            "seatIds": [seat["id"] for seat in selection],
            "durationMinutes": int(data.get("durationMinutes", 5)),
        }
        if data.get("showtimeId"):
            payload["showtimeId"] = data["showtimeId"]
        else:
            payload["eventId"] = data["eventId"]
        return jsonify(
            ticket_seat_request(
                "POST",
                "/holds",
                headers=ticket_seat_headers({"Content-Type": "application/json"}),
                json=payload,
            )
        ), 201
    except Exception as error:
        return json_error(error)


@app.post("/api/purchases")
def api_create_purchase():
    try:
        data = request.get_json(force=True)
        selection = normalize_selection(data.get("selection", []))
        total = sum(int(seat.get("price") or 0) for seat in selection)
        customer = {"name": data.get("customerName") or "Client demo"}
        if data.get("customerEmail"):
            customer["email"] = data["customerEmail"]
        payload = {
            "layoutId": data["layoutId"],
            "holdId": data["holdId"],
            "selection": selection,
            "total": total,
            "currency": data.get("currency", "XOF"),
            "customer": customer,
            "metadata": {
                "source": "python-flask-ticket-seat-example",
                "partnerReference": f"demo-{uuid4()}",
            },
        }
        if data.get("showtimeId"):
            payload["showtimeId"] = data["showtimeId"]
        else:
            payload["eventId"] = data["eventId"]
        return jsonify(
            ticket_seat_request(
                "POST",
                "/purchases",
                headers=ticket_seat_headers(
                    {
                        "Content-Type": "application/json",
                        "X-Idempotency-Key": f"demo-{uuid4()}",
                    }
                ),
                json=payload,
            )
        ), 201
    except Exception as error:
        return json_error(error)


@app.post("/webhooks/ticket-seat")
def ticket_seat_webhook():
    raw_body = request.get_data()
    valid, signature_message = verify_webhook_signature(raw_body)
    if not valid:
        return jsonify({"error": signature_message}), 401

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except ValueError:
        payload = {"raw": raw_body.decode("utf-8", errors="replace")}

    WEBHOOK_EVENTS.insert(
        0,
        {
            "receivedAt": datetime.now(timezone.utc).isoformat(),
            "event": request.headers.get("x-ticket-store-event") or payload.get("event"),
            "deliveryId": request.headers.get("x-ticket-store-delivery-id")
            or payload.get("deliveryId"),
            "signature": signature_message,
            "payload": payload,
        },
    )
    del WEBHOOK_EVENTS[50:]
    return jsonify({"received": True})


@app.get("/admin/webhooks")
def admin_webhooks():
    return render_template("webhooks.html", events=WEBHOOK_EVENTS)


@app.get("/admin/webhooks.json")
def admin_webhooks_json():
    return jsonify(WEBHOOK_EVENTS)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
