from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import argparse
import base64
import json
import mimetypes
import os
import threading
import time


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STORE_PATH = DATA_DIR / "push-store.json"
VAPID_PATH = DATA_DIR / "vapid.json"
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", "mailto:loopwise@example.com")


def b64url(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_store():
    if not STORE_PATH.exists():
        return {"subscriptions": []}
    return json.loads(STORE_PATH.read_text(encoding="utf-8"))


def save_store(store):
    ensure_data_dir()
    STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def load_vapid_keys():
    ensure_data_dir()
    if VAPID_PATH.exists():
        keys = json.loads(VAPID_PATH.read_text(encoding="utf-8"))
        if keys.get("privateKey", "").startswith("-----BEGIN"):
            from cryptography.hazmat.primitives import serialization

            private_key = serialization.load_pem_private_key(
                keys["privateKey"].encode("utf-8"),
                password=None,
            )
            private_der = private_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            keys["privateKey"] = b64url(private_der)
            VAPID_PATH.write_text(json.dumps(keys, indent=2), encoding="utf-8")
        return keys

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_numbers = private_key.public_key().public_numbers()
    public_raw = (
        b"\x04"
        + public_numbers.x.to_bytes(32, "big")
        + public_numbers.y.to_bytes(32, "big")
    )
    keys = {
        "publicKey": b64url(public_raw),
        "privateKey": b64url(private_der),
    }
    VAPID_PATH.write_text(json.dumps(keys, indent=2), encoding="utf-8")
    return keys


def upsert_subscription(subscription, schedule):
    if not subscription or not subscription.get("endpoint"):
        raise ValueError("Missing subscription endpoint.")

    store = load_store()
    existing = next(
        (
            item
            for item in store["subscriptions"]
            if item["subscription"].get("endpoint") == subscription["endpoint"]
        ),
        None,
    )
    record = {
        "subscription": subscription,
        "schedule": schedule or {"active": False},
        "lastReminderKey": existing.get("lastReminderKey", "") if existing else "",
        "lastReflectionKey": existing.get("lastReflectionKey", "") if existing else "",
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    if existing:
        store["subscriptions"] = [
            record if item is existing else item for item in store["subscriptions"]
        ]
    else:
        store["subscriptions"].append(record)
    save_store(store)


def build_reminder_payload(schedule):
    return {
        "title": "Loopwise",
        "body": (
            f"{schedule.get('focus') or 'Kom ihåg dagens fokus.'}\n\n"
            f"{schedule.get('lastAdjustment') or 'Ingen senaste lärdom än.'}"
        ),
        "tag": "loopwise-reminder",
        "data": {"type": "reminder"},
    }


def build_reflection_payload():
    return {
        "title": "Loopwise",
        "body": "Vad fungerade bra?\n\nVad kan du göra annorlunda nästa gång?",
        "tag": "loopwise-reflection",
        "data": {"type": "reflection"},
    }


def send_push(record, payload):
    from pywebpush import webpush

    keys = load_vapid_keys()
    return webpush(
        subscription_info=record["subscription"],
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=keys["privateKey"],
        vapid_claims={"sub": CONTACT_EMAIL},
    )


def send_to_all(payload):
    store = load_store()
    sent = 0
    failed = 0
    for record in store["subscriptions"]:
        try:
            send_push(record, payload)
            sent += 1
        except Exception as error:
            failed += 1
            print(f"Push failed: {error}", flush=True)
    return {"sent": sent, "failed": failed}


def schedule_loop(stop_event):
    while not stop_event.wait(20):
        store = load_store()
        if not store["subscriptions"]:
            continue

        now = time.localtime()
        minute = now.tm_min
        hour_key = time.strftime("%Y-%m-%d-%H", now)
        changed = False

        for record in store["subscriptions"]:
            schedule = record.get("schedule") or {}
            if not schedule.get("active"):
                continue

            if minute == int(schedule.get("reminderMinute", -1)) and record.get("lastReminderKey") != hour_key:
                try:
                    send_push(record, build_reminder_payload(schedule))
                except Exception as error:
                    print(f"Scheduled reminder push failed: {error}", flush=True)
                record["lastReminderKey"] = hour_key
                changed = True

            if minute == int(schedule.get("reflectionMinute", -1)) and record.get("lastReflectionKey") != hour_key:
                try:
                    send_push(record, build_reflection_payload())
                except Exception as error:
                    print(f"Scheduled reflection push failed: {error}", flush=True)
                record["lastReflectionKey"] = hour_key
                changed = True

        if changed:
            save_store(store)


class LoopwiseHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", os.environ.get("ALLOWED_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {"ok": True})
            return
        if path == "/vapid-public-key":
            try:
                self.send_json(200, {"publicKey": load_vapid_keys()["publicKey"]})
            except Exception as error:
                self.send_json(503, {"error": str(error)})
            return
        self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path in ("/subscribe", "/schedule"):
                upsert_subscription(body.get("subscription"), body.get("schedule"))
                self.send_json(200, {"ok": True})
                return
            if path == "/push/test":
                result = send_to_all(build_reminder_payload(body))
                self.send_json(200, {"ok": True, **result})
                return
            self.send_json(404, {"error": "Not found"})
        except Exception as error:
            print(error, flush=True)
            self.send_json(500, {"error": str(error)})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, request_path):
        clean = unquote(request_path).lstrip("/") or "index.html"
        target = (ROOT / clean).resolve()
        if not str(target).startswith(str(ROOT)):
            self.send_json(403, {"error": "Forbidden"})
            return
        if not target.exists() or target.is_dir():
            target = ROOT / "index.html"
        content = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".webmanifest":
            content_type = "application/manifest+json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    args = parser.parse_args()

    ensure_data_dir()
    stop_event = threading.Event()
    scheduler = threading.Thread(target=schedule_loop, args=(stop_event,), daemon=True)
    scheduler.start()

    server = ThreadingHTTPServer((args.host, args.port), LoopwiseHandler)
    print(f"Loopwise server lyssnar på http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        stop_event.set()


if __name__ == "__main__":
    main()
