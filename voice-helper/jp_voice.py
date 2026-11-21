#!/usr/bin/env python3
"""Japanese Tutor voice helper: free, offline speech for the tutor web app.

Runs a tiny HTTP server on 127.0.0.1 (this computer only):
  GET  /                       -> the tutor app itself (files from the app folder)
  GET  /health                 -> what's available
  POST /listen?lang=ja&model=small -> records from the microphone until you
                                  pause, then {"text": ...}
  POST /listen/stop | /listen/cancel, GET /listen/status
  POST /stt?lang=ja&model=small  body: recorded audio (webm/ogg/wav) -> {"text": ...}
  POST /tts  {"text": ..., "lang": "ja"|"en", "speed": 1.0}  -> audio/wav

Speech-to-text: Whisper via faster-whisper (CPU, int8).
Japanese voice: Open JTalk via pyopenjtalk.  English voice: Piper (if installed).
Nothing leaves this computer; models are downloaded once on first use.
"""
import io
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = 1
PORT = int(os.environ.get("JP_VOICE_PORT", "8770"))
HOME = Path(os.environ.get("JP_VOICE_HOME", Path.home() / ".local/share/japanese-tutor"))
MODELS_DIR = HOME / "models"
PIPER_VOICE = MODELS_DIR / "piper" / "en_US-lessac-medium.onnx"
APP_DIR = Path(os.environ.get("JP_VOICE_APP", HOME / "app"))
ALLOWED_ORIGINS = {
    f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}",
    "https://mrshmonke.github.io",
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:8765", "http://127.0.0.1:8765",
}
WHISPER_SIZES = ["tiny", "base", "small", "medium", "large-v3-turbo"]
DEFAULT_SIZE = os.environ.get("JP_VOICE_MODEL", "small")
IDLE_UNLOAD_SEC = 15 * 60   # free the RAM if voice input isn't used for a while

_lock = threading.Lock()
_whisper = {"size": None, "model": None, "last": 0.0, "loading": None}
_piper = {"voice": None}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------- speech to text ----------
def get_whisper(size):
    from faster_whisper import WhisperModel
    with _lock:
        if _whisper["model"] is None or _whisper["size"] != size:
            _whisper["model"] = None
            _whisper["loading"] = size
            log(f"loading Whisper {size} (downloads once if needed)...")
            threads = max(1, (os.cpu_count() or 2) - 1)
            _whisper["model"] = WhisperModel(size, device="cpu", compute_type="int8",
                                             cpu_threads=threads,
                                             download_root=str(MODELS_DIR / "whisper"))
            _whisper["size"] = size
            _whisper["loading"] = None
            log(f"Whisper {size} ready")
        _whisper["last"] = time.time()
        return _whisper["model"]


def transcribe(audio, lang, size):
    """audio: encoded bytes (webm/ogg/wav) or a float32 numpy array at 16 kHz."""
    model = get_whisper(size)
    opts = dict(language=lang if lang in ("ja", "en") else None,
                beam_size=1 if size in ("medium", "large-v3-turbo") else 3,
                vad_filter=True, condition_on_previous_text=False)
    if isinstance(audio, (bytes, bytearray)):
        with tempfile.NamedTemporaryFile(suffix=".audio") as f:
            f.write(audio)
            f.flush()
            segments, _info = model.transcribe(f.name, **opts)
            text = "".join(s.text for s in segments).strip()
    else:
        segments, _info = model.transcribe(audio, **opts)
        text = "".join(s.text for s in segments).strip()
    _whisper["last"] = time.time()
    return text


# ---------- microphone (recorded here, so no browser permissions needed) ----------
RATE = 16000
_mic = {"state": "idle", "stop": False, "cancel": False, "proc": None}
_mic_lock = threading.Lock()


def recorder_cmd():
    if shutil.which("parecord"):
        return ["parecord", "--raw", "--format=s16le", f"--rate={RATE}", "--channels=1", "--latency-msec=50"]
    if shutil.which("arecord"):
        return ["arecord", "-q", "-f", "S16_LE", "-r", str(RATE), "-c", "1", "-t", "raw"]
    if shutil.which("pw-record"):
        return ["pw-record", "--rate", str(RATE), "--channels", "1", "--format", "s16", "-"]
    return None


def record_until_pause(max_sec=30, give_up_sec=8, pause_sec=1.3):
    """Record from the default microphone; stop after a pause once speech was
    heard. Returns float32 audio, or None if nothing was said / cancelled."""
    import numpy as np
    cmd = recorder_cmd()
    if not cmd:
        raise RuntimeError("No audio recorder found (parecord, arecord or pw-record).")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    _mic.update(state="listening", stop=False, cancel=False, proc=proc)
    chunk = RATE // 10 * 2          # 100 ms of 16-bit samples
    frames, floor, n_floor, spoke, quiet = [], 0.0, 0, False, 0.0
    start = time.time()
    try:
        while True:
            data = proc.stdout.read(chunk)
            if not data:
                break
            x = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            frames.append(x)
            rms = float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
            t = time.time() - start
            if t < 0.3:
                floor += rms
                n_floor += 1
            else:
                base = floor / n_floor if n_floor else 0.005
                if rms > max(0.012, base * 3):
                    spoke, quiet = True, 0.0
                    _mic["state"] = "hearing"
                elif spoke:
                    quiet += 0.1
                    if quiet >= pause_sec:
                        break
            if _mic["stop"] or _mic["cancel"] or t > max_sec or (not spoke and t > give_up_sec):
                break
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()
    if _mic["cancel"] or not frames or (not spoke and not _mic["stop"]):
        return None
    return np.concatenate(frames)


def listen(lang, size):
    if not _mic_lock.acquire(blocking=False):
        raise RuntimeError("Already listening.")
    try:
        # Load the model while the person talks, so transcription starts sooner.
        threading.Thread(target=get_whisper, args=(size,), daemon=True).start()
        audio = record_until_pause()
        if audio is None:
            return ""
        _mic["state"] = "transcribing"
        # Transcribe in the background so Cancel returns right away.
        result = {}

        def work():
            try:
                result["text"] = transcribe(audio, lang, size)
            except Exception as e:
                result["error"] = e
        t = threading.Thread(target=work, daemon=True)
        t.start()
        while t.is_alive():
            if _mic["cancel"]:
                log("transcription cancelled")
                return ""
            t.join(0.1)
        if "error" in result:
            raise result["error"]
        return result.get("text", "")
    finally:
        _mic.update(state="idle", proc=None)
        _mic_lock.release()


def unload_when_idle():
    while True:
        time.sleep(60)
        with _lock:
            if _whisper["model"] is not None and time.time() - _whisper["last"] > IDLE_UNLOAD_SEC:
                _whisper["model"] = None
                _whisper["size"] = None
                log("Whisper unloaded (idle)")


# ---------- text to speech ----------
def wav_bytes(samples_int16, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples_int16.tobytes())
    return buf.getvalue()


def tts_ja(text, speed):
    import numpy as np
    import pyopenjtalk
    x, sr = pyopenjtalk.tts(text, speed=speed)
    return wav_bytes(np.clip(x, -32768, 32767).astype(np.int16), sr)


def piper_available():
    try:
        import piper  # noqa: F401
    except Exception:
        return False
    return PIPER_VOICE.exists()


def tts_en(text, speed):
    from piper import PiperVoice, SynthesisConfig
    with _lock:
        if _piper["voice"] is None:
            _piper["voice"] = PiperVoice.load(str(PIPER_VOICE))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        _piper["voice"].synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=1.0 / max(0.5, speed)))
    return buf.getvalue()


# ---------- one-click voice setup (from the app's Settings) ----------
_setup = {"state": "idle", "step": "", "error": ""}
VENV_PY = HOME / "venv" / "bin" / "python"


def run_setup(model):
    script = Path(__file__).with_name("setup-voice.sh")
    _setup.update(state="running", step="Starting", error="")
    log_path = HOME / "voice-setup.log"
    try:
        with open(log_path, "w") as logf:
            p = subprocess.Popen(["bash", str(script), model], stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                logf.write(line)
                if line.startswith("STEP: "):
                    _setup["step"] = line[6:].strip()
            p.wait()
        if p.returncode != 0:
            _setup.update(state="failed", error=f"Setup failed. Details: {log_path}")
            return
        _setup.update(state="restarting", step="Restarting with voice")
        log("voice setup finished; restarting with the voice environment")
        time.sleep(0.5)
        os.execv(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve())])
    except Exception as e:
        _setup.update(state="failed", error=str(e))


def available():
    out = {"version": VERSION, "stt": False, "tts_ja": False, "tts_en": False,
           "native_mic": recorder_cmd() is not None,
           "setup": dict(_setup),
           "models": WHISPER_SIZES, "default_model": DEFAULT_SIZE,
           "loaded_model": _whisper["size"], "loading": _whisper["loading"],
           "downloaded": sorted(p.name.split("faster-whisper-")[-1]
                                for p in (MODELS_DIR / "whisper").glob("models--*"))
                         if (MODELS_DIR / "whisper").exists() else []}
    try:
        import faster_whisper  # noqa: F401
        out["stt"] = True
    except Exception:
        pass
    try:
        import pyopenjtalk  # noqa: F401
        out["tts_ja"] = True
    except Exception:
        pass
    out["tts_en"] = piper_available()
    return out


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "jp-voice/1"

    def log_message(self, fmt, *args):
        pass

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome's Private Network Access preflight
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass   # the app stopped waiting (e.g. Cancel)

    def origin_ok(self):
        origin = self.headers.get("Origin")
        # Requests from other web pages are refused; no Origin means a local tool like curl.
        return origin is None or origin in ALLOWED_ORIGINS

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def body(self, limit=25 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("request too large")
        return self.rfile.read(n)

    def do_GET(self):
        if not self.origin_ok():
            return self.reply(403, {"error": "origin not allowed"})
        path = urlparse(self.path).path
        if path == "/health":
            return self.reply(200, available())
        if path == "/listen/status":
            return self.reply(200, {"state": _mic["state"]})
        return self.static(path)

    def static(self, path):
        # Serve the tutor app's files (only from inside the app folder).
        rel = path.lstrip("/") or "index.html"
        target = (APP_DIR / rel).resolve()
        if APP_DIR.resolve() not in target.parents and target != APP_DIR.resolve():
            return self.reply(404, {"error": "not found"})
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self.reply(404, {"error": "not found"})
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix in (".js", ".mjs"):
            ctype = "text/javascript"
        if target.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        self.reply(200, target.read_bytes(), ctype)

    def do_POST(self):
        if not self.origin_ok():
            return self.reply(403, {"error": "origin not allowed"})
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/listen":
                size = q.get("model", DEFAULT_SIZE)
                if size not in WHISPER_SIZES:
                    return self.reply(400, {"error": f"model must be one of {WHISPER_SIZES}"})
                t = time.time()
                text = listen(q.get("lang", "ja"), size)
                log(f"listen {size} {q.get('lang')} {time.time() - t:.1f}s: {text[:60]}")
                return self.reply(200, {"text": text})
            if url.path == "/setup/voice":
                if _setup["state"] != "running":
                    size = q.get("model", DEFAULT_SIZE)
                    if size not in WHISPER_SIZES:
                        size = DEFAULT_SIZE
                    threading.Thread(target=run_setup, args=(size,), daemon=True).start()
                return self.reply(200, {"ok": True})
            if url.path in ("/listen/stop", "/listen/cancel"):
                _mic["stop" if url.path.endswith("stop") else "cancel"] = True
                return self.reply(200, {"ok": True})
            if url.path == "/stt":
                size = q.get("model", DEFAULT_SIZE)
                if size not in WHISPER_SIZES:
                    return self.reply(400, {"error": f"model must be one of {WHISPER_SIZES}"})
                t = time.time()
                text = transcribe(self.body(), q.get("lang", "ja"), size)
                log(f"stt {size} {q.get('lang')} {time.time() - t:.1f}s: {text[:60]}")
                return self.reply(200, {"text": text, "seconds": round(time.time() - t, 2)})
            if url.path == "/tts":
                req = json.loads(self.body(1024 * 1024) or b"{}")
                text = str(req.get("text", "")).strip()[:2000]
                speed = float(req.get("speed", 1.0))
                if not text:
                    return self.reply(400, {"error": "no text"})
                if req.get("lang", "ja") == "en":
                    if not piper_available():
                        return self.reply(501, {"error": "English voice not installed"})
                    return self.reply(200, tts_en(text, speed), "audio/wav")
                return self.reply(200, tts_ja(text, speed), "audio/wav")
        except Exception as e:
            log("error:", repr(e))
            return self.reply(500, {"error": str(e)})
        self.reply(404, {"error": "not found"})


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--download":
        # Pre-download a model at install time: jp_voice.py --download small
        get_whisper(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SIZE)
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=unload_when_idle, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"Japanese Tutor voice helper on http://127.0.0.1:{PORT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
