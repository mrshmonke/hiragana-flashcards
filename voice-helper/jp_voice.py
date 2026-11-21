#!/usr/bin/env python3
"""Japanese Tutor voice helper: free, offline speech for the tutor web app.

Runs a tiny HTTP server on 127.0.0.1 (this computer only):
  GET  /                       -> the tutor app itself (files from the app folder)
  GET  /health                 -> what's available
  POST /listen?lang=ja&model=small -> records from the microphone until you
                                  pause, then {"text": ...}
  POST /listen/stop | /listen/cancel, GET /listen/status
  POST /model/load?model=medium  -> download (once) and load a speech model now
  POST /model/cancel             -> stop a download (Retry resumes it)
  GET  /model/status             -> {"phase": downloading|loading|ready|idle, "mb", "total_mb", ...}
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

VERSION = 2
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

_lock = threading.Lock()      # English voice
_wlock = threading.Lock()     # Whisper (separate, so a long download never blocks speech)
_whisper = {"size": None, "model": None, "last": 0.0, "loading": None, "load_started": 0.0, "error": ""}
# Approximate download sizes, for the progress readout.
WHISPER_MB = {"tiny": 75, "base": 145, "small": 485, "medium": 1530, "large-v3-turbo": 1620}
_piper = {"voice": None}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------- speech to text ----------
WHISPER_REPOS = {s: f"Systran/faster-whisper-{s}" for s in ("tiny", "base", "small", "medium")}
WHISPER_REPOS["large-v3-turbo"] = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
HF = os.environ.get("JP_VOICE_HF", "https://huggingface.co")
STALL_SEC = 45       # give up if no data arrives for this long


def model_folder(size):
    return MODELS_DIR / "whisper" / size


def hf_cache_dir(size):
    # Where older versions of this app downloaded models (Hugging Face cache layout).
    return MODELS_DIR / "whisper" / ("models--" + WHISPER_REPOS[size].replace("/", "--"))


def whisper_path(size):
    """Folder holding a complete copy of the model, or None."""
    d = model_folder(size)
    if (d / "model.bin").exists() and (d / "config.json").exists():
        return d
    for snap in sorted(hf_cache_dir(size).glob("snapshots/*")):
        if (snap / "model.bin").exists():
            return snap
    return None


def whisper_downloaded(size):
    return whisper_path(size) is not None


# What the speech model is doing, for the app's status display.
_dl = {"size": None, "file": "", "have": 0, "total": 0, "started": 0.0, "speed": 0.0,
       "cancel": False, "error": "", "error_size": None, "phase": None}
_dl_lock = threading.Lock()


class Cancelled(Exception):
    pass


def http_get(url, headers=None, timeout=STALL_SEC):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "japanese-tutor-voice", **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout)


def repo_files(repo):
    """[(name, size, sha256 or None)] for the model's files."""
    with http_get(f"{HF}/api/models/{repo}/tree/main") as r:
        items = json.loads(r.read())
    out = []
    for it in items:
        name = it.get("path", "")
        if it.get("type") != "file" or name in (".gitattributes", "README.md") or "/" in name:
            continue
        lfs = it.get("lfs") or {}
        out.append((name, int(lfs.get("size") or it.get("size") or 0), lfs.get("oid")))
    if not any(n == "model.bin" for n, _s, _o in out):
        raise RuntimeError("the model listing from huggingface.co looks wrong")
    return out


def download_whisper(size):
    """Download the model's files into models/whisper/<size>/ with progress,
    resuming partial files. Returns the folder."""
    repo = WHISPER_REPOS[size]
    dest = model_folder(size)
    dest.mkdir(parents=True, exist_ok=True)
    _dl.update(size=size, phase="downloading", file="(getting the file list)", have=0, total=0,
               started=time.time(), speed=0.0, cancel=False, error="", error_size=None)
    log(f"downloading Whisper {size} from {HF}/{repo} into {dest}")
    files = repo_files(repo)
    _dl["total"] = sum(sz for _n, sz, _o in files)
    done_before = 0
    window = []   # (time, bytes) for the speed readout
    for name, sz, oid in files:
        target = dest / name
        if target.exists() and (not sz or target.stat().st_size == sz):
            done_before += target.stat().st_size
            _dl["have"] = done_before
            continue
        part = dest / (name + ".part")
        # Pick up a half-finished download from the older downloader, if any.
        old = hf_cache_dir(size) / "blobs" / f"{oid}.incomplete" if oid else None
        if old and old.exists() and (not part.exists() or old.stat().st_size > part.stat().st_size):
            shutil.move(str(old), str(part))
            log(f"resuming {name} from an earlier download ({old.stat().st_size if old.exists() else part.stat().st_size} bytes)")
        have = part.stat().st_size if part.exists() else 0
        if sz and have > sz:
            part.unlink()
            have = 0
        _dl["file"] = name
        headers = {"Range": f"bytes={have}-"} if have else {}
        with http_get(f"{HF}/{repo}/resolve/main/{name}", headers) as r:
            if have and r.status != 206:
                have = 0   # server ignored the resume request; start the file over
            with open(part, "ab" if have else "wb") as f:
                while True:
                    if _dl["cancel"]:
                        raise Cancelled()
                    try:
                        chunk = r.read(1 << 20)
                    except TimeoutError:
                        raise RuntimeError(f"no data from huggingface.co for {STALL_SEC} seconds "
                                           "(internet connection dropped or very slow)")
                    if not chunk:
                        break
                    f.write(chunk)
                    have += len(chunk)
                    _dl["have"] = done_before + have
                    now = time.time()
                    window.append((now, _dl["have"]))
                    while window and now - window[0][0] > 5:
                        window.pop(0)
                    if len(window) > 1 and now > window[0][0]:
                        _dl["speed"] = (window[-1][1] - window[0][1]) / (now - window[0][0])
        if sz and have != sz:
            raise RuntimeError(f"{name} stopped at {have} of {sz} bytes; press Retry to continue")
        os.replace(part, target)
        done_before += have
    log(f"Whisper {size} downloaded ({_dl['total'] / 1e6:.0f} MB)")
    return dest


def ensure_whisper(size):
    path = whisper_path(size)
    if path:
        return path
    with _dl_lock:   # one download at a time; a second caller waits for it
        path = whisper_path(size)
        if path:
            return path
        try:
            return download_whisper(size)
        except Cancelled:
            log(f"download of Whisper {size} cancelled")
            _dl.update(error="Download cancelled. Press Retry to continue where it stopped.", error_size=size)
            raise
        except Exception as e:
            log(f"download of Whisper {size} failed: {e!r}")
            _dl.update(error=f"Download failed: {e}", error_size=size)
            raise
        finally:
            _dl.update(phase=None, cancel=False)


def whisper_progress():
    """What the speech model is doing right now, for the app's status line."""
    if _dl["phase"] == "downloading":
        have, total, speed = _dl["have"], _dl["total"], _dl["speed"]
        return {"phase": "downloading", "size": _dl["size"], "file": _dl["file"],
                "mb": round(have / 1e6), "total_mb": round(total / 1e6) or WHISPER_MB.get(_dl["size"], 0),
                "mbps": round(speed / 1e6, 1),
                "eta_s": round((total - have) / speed) if speed > 0 and total > have else None,
                "elapsed_s": round(time.time() - _dl["started"]),
                "dest": str(model_folder(_dl["size"]))}
    if _whisper["loading"]:
        return {"phase": "loading", "size": _whisper["loading"],
                "elapsed_s": round(time.time() - _whisper["load_started"])}
    return {"phase": "ready" if _whisper["size"] else "idle", "size": _whisper["size"],
            "error": _dl["error"] or _whisper["error"], "error_size": _dl["error_size"]}


def get_whisper(size):
    from faster_whisper import WhisperModel
    path = ensure_whisper(size)
    with _wlock:
        if _whisper["model"] is None or _whisper["size"] != size:
            _whisper.update(model=None, size=None, loading=size, error="", load_started=time.time())
            _dl.update(error="", error_size=None)
            try:
                t = time.time()
                threads = max(1, (os.cpu_count() or 2) - 1)
                _whisper["model"] = WhisperModel(str(path), device="cpu", compute_type="int8",
                                                 cpu_threads=threads)
                _whisper["size"] = size
                log(f"Whisper {size} ready (loaded in {time.time() - t:.1f}s)")
            except Exception as e:
                _whisper["error"] = f"Couldn't load the {size} speech model: {e}"
                raise
            finally:
                _whisper["loading"] = None
        _whisper["last"] = time.time()
        return _whisper["model"]


def preload(size):
    try:
        get_whisper(size)
    except Exception as e:
        log("preload failed:", repr(e))


def pick_size(size):
    """The model to use right now: the one asked for, or, while that one is still
    downloading, one that's already on disk so voice keeps working."""
    if whisper_downloaded(size):
        return size, ""
    ready = [_whisper["size"]] if _whisper["size"] else []
    ready += [s for s in WHISPER_SIZES if whisper_downloaded(s) and s not in ready]
    if not ready:
        return size, ""
    threading.Thread(target=preload, args=(size,), daemon=True).start()
    return ready[0], f"Used the {ready[0]} model while {size} downloads."


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
        size, _note = pick_size(size)
        # Load the model while the person talks, so transcription starts sooner.
        threading.Thread(target=preload, args=(size,), daemon=True).start()
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
        with _wlock:
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
    out = {"version": VERSION, "pid": os.getpid(), "stt": False, "tts_ja": False, "tts_en": False,
           "native_mic": recorder_cmd() is not None,
           "setup": dict(_setup),
           "models": WHISPER_SIZES, "default_model": DEFAULT_SIZE,
           "loaded_model": _whisper["size"], "loading": _whisper["loading"],
           "model_status": whisper_progress(),
           "downloaded": [s for s in WHISPER_SIZES if whisper_downloaded(s)]}
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
            return self.reply(200, {"state": _mic["state"], "model": whisper_progress()})
        if path == "/model/status":
            return self.reply(200, whisper_progress())
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
            if url.path == "/quit":
                if self.headers.get("Origin"):
                    return self.reply(403, {"error": "not allowed"})
                self.reply(200, {"ok": True})
                threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0)), daemon=True).start()
                return
            if url.path == "/model/cancel":
                _dl["cancel"] = True
                return self.reply(200, {"ok": True})
            if url.path == "/model/load":
                size = q.get("model", DEFAULT_SIZE)
                if size not in WHISPER_SIZES:
                    return self.reply(400, {"error": f"model must be one of {WHISPER_SIZES}"})
                threading.Thread(target=preload, args=(size,), daemon=True).start()
                return self.reply(200, {"ok": True})
            if url.path in ("/listen/stop", "/listen/cancel"):
                _mic["stop" if url.path.endswith("stop") else "cancel"] = True
                return self.reply(200, {"ok": True})
            if url.path == "/stt":
                size = q.get("model", DEFAULT_SIZE)
                if size not in WHISPER_SIZES:
                    return self.reply(400, {"error": f"model must be one of {WHISPER_SIZES}"})
                t = time.time()
                text = transcribe(self.body(), q.get("lang", "ja"), pick_size(size)[0])
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
