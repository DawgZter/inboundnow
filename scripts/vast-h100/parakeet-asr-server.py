#!/usr/bin/env python3
import base64
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("ASR_MODEL", "nvidia/parakeet-tdt-0.6b-v3")
HOST = os.environ.get("ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("ASR_PORT", "4341"))

asr_model = None


def load_model():
    global asr_model
    if asr_model is None:
        import nemo.collections.asr as nemo_asr

        asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=MODEL)
    return asr_model


def response_text(item):
    if hasattr(item, "text"):
        return item.text
    if isinstance(item, dict):
        return item.get("text") or item.get("transcript") or ""
    return str(item or "")


class Handler(BaseHTTPRequestHandler):
    server_version = "InboundNowParakeetASR/0.1"

    def json_response(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.json_response(404, {"ok": False, "error": "not_found"})
            return
        self.json_response(200, {
            "ok": True,
            "provider": "local-parakeet",
            "model": MODEL,
            "localOnly": True,
            "loaded": asr_model is not None,
        })

    def do_POST(self):
        if self.path != "/v1/asr/transcribe":
            self.json_response(404, {"ok": False, "error": "not_found"})
            return

        length = int(self.headers.get("content-length") or "0")
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        audio_path = payload.get("audioPath") or ""
        temp_path = ""

        try:
            if payload.get("audioBase64"):
                suffix = ".wav" if payload.get("mimeType", "audio/wav").endswith("wav") else ".audio"
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                    handle.write(base64.b64decode(payload["audioBase64"]))
                    temp_path = handle.name
                    audio_path = temp_path

            if not audio_path:
                self.json_response(400, {"ok": False, "error": "audioBase64 or audioPath is required"})
                return

            model = load_model()
            output = model.transcribe([audio_path], timestamps=payload.get("timestamps", True))
            first = output[0] if output else ""
            transcript = response_text(first)
            timestamps = getattr(first, "timestamp", None) if hasattr(first, "timestamp") else None
            self.json_response(200, {
                "ok": True,
                "provider": "local-parakeet",
                "model": MODEL,
                "transcript": transcript,
                "language": payload.get("language") or "en",
                "final": True,
                "timestamps": timestamps,
            })
        except Exception as error:
            self.json_response(500, {"ok": False, "error": str(error), "provider": "local-parakeet", "model": MODEL})
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print(f"Starting local Parakeet ASR endpoint on http://{HOST}:{PORT} using {MODEL}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
