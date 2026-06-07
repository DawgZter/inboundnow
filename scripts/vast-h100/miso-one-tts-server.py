#!/usr/bin/env python3
import base64
import hashlib
import inspect
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch


HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "4331"))
MODEL = os.environ.get("TTS_MODEL") or os.environ.get("MISO_TTS_MODEL") or "MisoLabs/MisoTTS"
VENDOR_DIR = Path(os.environ.get("MISO_TTS_REPO_DIR", "artifacts/vendor/MisoTTS")).resolve()
MAX_AUDIO_MS = int(os.environ.get("MISO_TTS_MAX_AUDIO_MS", "12000"))
CHUNK_BYTES = int(os.environ.get("TTS_PCM_CHUNK_BYTES", "24000"))
REQUIRE_LORA = os.environ.get("MISO_REQUIRE_LORA", "0").lower() in ("1", "true", "yes", "on")
TTS_DTYPE = os.environ.get("TTS_DTYPE", "bfloat16")
TTS_QUANTIZATION = os.environ.get("TTS_QUANTIZATION", "none")


generator = None
generator_loaded_at = None
generate_lock = threading.Lock()


def requested_dtype():
    value = str(TTS_DTYPE or "").lower()
    if value in ("", "auto", "none"):
        return None
    if value in ("bf16", "bfloat16"):
        return torch.bfloat16
    if value in ("fp16", "float16", "half"):
        return torch.float16
    if value in ("fp32", "float32"):
        return torch.float32
    raise RuntimeError("Unsupported TTS_DTYPE for MisoTTS wrapper: %s" % TTS_DTYPE)


def repo_import_path():
    if not VENDOR_DIR.exists():
        raise RuntimeError("MisoTTS repo is missing at %s; run scripts/vast-h100/setup-miso-lora-dev.sh" % VENDOR_DIR)
    sys.path.insert(0, str(VENDOR_DIR))


def load_generator():
    global generator, generator_loaded_at
    if generator is not None:
        return generator
    repo_import_path()
    from generator import load_miso_8b

    device = "cuda" if torch.cuda.is_available() else "cpu"
    kwargs = {"device": device, "model_path_or_repo_id": MODEL}
    dtype = requested_dtype()
    if dtype is not None:
        signature = inspect.signature(load_miso_8b)
        if "torch_dtype" in signature.parameters:
            kwargs["torch_dtype"] = dtype
        elif "dtype" in signature.parameters:
            kwargs["dtype"] = dtype
    generator = load_miso_8b(**kwargs)
    generator_loaded_at = time.time()
    return generator


def read_json(handler):
    length = int(handler.headers.get("content-length") or "0")
    body = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(body or "{}")


def write_json(handler, status, payload, content_type="application/json"):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", content_type)
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def tensor_to_pcm16(audio):
    if isinstance(audio, (list, tuple)) and audio:
        audio = audio[0]
    if isinstance(audio, dict):
        audio = audio.get("audio") or audio.get("wav") or audio.get("samples")
    if hasattr(audio, "detach"):
        audio = audio.detach().float().cpu()
    audio = audio.reshape(-1).clamp(-1.0, 1.0)
    pcm = (audio * 32767.0).to(torch.int16).numpy().tobytes()
    return pcm


def device_name():
    return "cuda" if torch.cuda.is_available() else "cpu"


def gpu_name():
    if not torch.cuda.is_available():
        return ""
    return torch.cuda.get_device_name(0)


def stream_ndjson(handler, events):
    handler.send_response(200)
    handler.send_header("content-type", "application/x-ndjson")
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    for event in events:
        handler.wfile.write((json.dumps(event) + "\n").encode("utf-8"))
        handler.wfile.flush()


def require_lora_path(payload):
    lora_adapter = str(payload.get("loraAdapter") or os.environ.get("MISO_LORA_ADAPTER") or "")
    if REQUIRE_LORA and (not lora_adapter or not Path(lora_adapter).exists()):
        raise RuntimeError("MISO_REQUIRE_LORA=1 but loraAdapter is missing or does not exist: %s" % lora_adapter)
    if REQUIRE_LORA:
        raise RuntimeError("MISO_REQUIRE_LORA=1 requested cloned-voice proof, but official MisoTTS LoRA adapter loading is not implemented in this wrapper yet. Leave MISO_REQUIRE_LORA=0 for base MisoTTS audio proof until a real adapter loader is added.")
    return lora_adapter


class Handler(BaseHTTPRequestHandler):
    server_version = "InboundNowMisoOneTTS/0.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        if self.path == "/health":
            write_json(self, 200, {
                "ok": True,
                "provider": "local-miso-one",
                "model": MODEL,
                "localOnly": True,
                "repoDir": str(VENDOR_DIR),
                "loaded": generator is not None,
                "loadedAt": generator_loaded_at,
                "device": device_name(),
                "gpuName": gpu_name(),
                "loraMode": "required" if REQUIRE_LORA else "optional",
                "dtype": TTS_DTYPE,
                "quantization": TTS_QUANTIZATION,
                "quantizationApplied": False,
                "loraRuntimeSupported": False,
                "boundary": "MisoTTS local inference wrapper; official LoRA adapter loading and quantization are not implemented by this wrapper yet.",
            })
            return
        write_json(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self):
        try:
            if self.path == "/prewarm":
                start = time.time()
                load_generator()
                write_json(self, 200, {
                    "ok": True,
                    "provider": "local-miso-one",
                    "model": MODEL,
                    "prewarmMs": round((time.time() - start) * 1000),
                    "localOnly": True,
                })
                return

            if self.path == "/v1/tts/stream":
                payload = read_json(self)
                text = str(payload.get("text") or "").strip()
                if not text:
                    write_json(self, 400, {"ok": False, "error": "text is required"})
                    return
                lora_adapter = require_lora_path(payload)
                gen = load_generator()
                started = time.time()
                with generate_lock:
                    audio = gen.generate(
                        text=text,
                        speaker=0,
                        context=[],
                        max_audio_length_ms=MAX_AUDIO_MS,
                    )
                sample_rate = int(getattr(gen, "sample_rate", 24000))
                pcm = tensor_to_pcm16(audio)
                audio_sha256 = hashlib.sha256(pcm).hexdigest()
                common = {
                    "provider": "local-miso-one",
                    "model": MODEL,
                    "voice": payload.get("voice") or "miso-one-lora-dev",
                    "style": payload.get("style") or "expressive",
                    "loraAdapter": lora_adapter,
                    "loraAdapterApplied": False,
                    "dtype": TTS_DTYPE,
                    "quantization": TTS_QUANTIZATION,
                    "quantizationApplied": False,
                    "format": "pcm16",
                    "sampleRate": sample_rate,
                    "channels": 1,
                    "cacheKey": payload.get("cacheKey") or "",
                    "cacheHit": False,
                    "localOnly": True,
                    "device": device_name(),
                    "gpuName": gpu_name(),
                    "pcmBytes": len(pcm),
                    "audioSha256": audio_sha256,
                    "generationSource": "fresh-model",
                    "boundary": "This wrapper uses local MisoTTS inference. LoRA adapter loading is reported separately and is not implied by loraAdapter metadata.",
                }
                events = [{
                    **common,
                    "type": "start",
                    "firstAudioMs": round((time.time() - started) * 1000),
                }]
                for index in range(0, len(pcm), CHUNK_BYTES):
                    chunk = pcm[index:index + CHUNK_BYTES]
                    events.append({
                        **common,
                        "type": "chunk",
                        "sequence": index // CHUNK_BYTES,
                        "audio": base64.b64encode(chunk).decode("ascii"),
                        "byteLength": len(chunk),
                        "chunkSha256": hashlib.sha256(chunk).hexdigest(),
                    })
                events.append({
                    **common,
                    "type": "end",
                    "chunkCount": max(0, len(events) - 1),
                    "totalMs": round((time.time() - started) * 1000),
                })
                stream_ndjson(self, events)
                return

            write_json(self, 404, {"ok": False, "error": "not found"})
        except Exception as error:
            write_json(self, 500, {"ok": False, "error": str(error), "provider": "local-miso-one", "model": MODEL})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Miso One TTS endpoint listening on http://%s:%s" % (HOST, PORT), flush=True)
    server.serve_forever()
