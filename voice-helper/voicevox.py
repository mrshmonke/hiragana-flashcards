"""Natural Japanese voices from VOICEVOX (free, offline, runs on the CPU).

Installs into ~/.local/share/japanese-tutor/voicevox/:
  - the VOICEVOX CORE Python package (from its GitHub release)
  - VOICEVOX's build of ONNX Runtime
  - the Open JTalk dictionary
  - voice models 0.vvm (四国めたん, ずんだもん, 春日部つむぎ, 雨晴はう) and 1.vvm (冥鳴ひまり)

VOICEVOX and its voices are free, including for personal study, under their terms:
https://voicevox.hiroshiba.jp/term/ and each character's own terms. Audio you
publish must credit "VOICEVOX:<character>".
"""
import importlib
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

CORE_VERSION = "0.16.4"
ORT_VERSION = "1.17.3"
VVM_VERSION = "0.16.4"
GH = os.environ.get("JP_VOICE_GH", "https://github.com")
WHEEL = f"voicevox_core-{CORE_VERSION}-cp310-abi3-manylinux_2_34_x86_64.whl"
DOWNLOADS = [
    # (label, url, file name, approx MB)
    ("VOICEVOX program", f"{GH}/VOICEVOX/voicevox_core/releases/download/{CORE_VERSION}/{WHEEL}", WHEEL, 2),
    ("speech engine (ONNX Runtime)",
     f"{GH}/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-{ORT_VERSION}/"
     f"voicevox_onnxruntime-linux-x64-{ORT_VERSION}.tgz", "onnxruntime.tgz", 7),
    ("Japanese dictionary",
     f"{GH}/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz", "dict.tar.gz", 23),
    ("voices 1 of 2 (めたん, ずんだもん, つむぎ, はう)",
     f"{GH}/VOICEVOX/voicevox_vvm/releases/download/{VVM_VERSION}/0.vvm", "0.vvm", 56),
    ("voices 2 of 2 (冥鳴ひまり)", f"{GH}/VOICEVOX/voicevox_vvm/releases/download/{VVM_VERSION}/1.vvm", "1.vvm", 57),
]
TOTAL_MB = sum(d[3] for d in DOWNLOADS)
TERMS_URL = "https://voicevox.hiroshiba.jp/term/"
DEFAULT_STYLE = 14   # 冥鳴ひまり: calm, clear, good for learners
# Shown when the engine isn't loaded yet (IDs from the voicevox_vvm README).
KNOWN_VOICES = [
    {"id": 14, "name": "冥鳴ひまり", "style": "ノーマル"},
    {"id": 8, "name": "春日部つむぎ", "style": "ノーマル"},
    {"id": 10, "name": "雨晴はう", "style": "ノーマル"},
    {"id": 2, "name": "四国めたん", "style": "ノーマル"},
    {"id": 3, "name": "ずんだもん", "style": "ノーマル"},
]


class Cancelled(Exception):
    pass


class VoiceVox:
    def __init__(self, home, log):
        self.dir = Path(home) / "voicevox"
        self.pylib = self.dir / "pylib"
        self.log = log
        self.lock = threading.Lock()
        self.synth = None
        self.voices = []
        self.status = {"state": "idle", "step": "", "mb": 0, "total_mb": TOTAL_MB, "error": "",
                       "mbps": 0.0, "eta_s": None}
        self.cancel = False
        if self.pylib.exists() and str(self.pylib) not in sys.path:
            sys.path.insert(0, str(self.pylib))

    # ----- paths -----
    def ort_lib(self):
        hits = sorted((self.dir / "onnxruntime").rglob("libvoicevox_onnxruntime.so*"))
        return hits[0] if hits else None

    def dict_dir(self):
        hits = sorted(p.parent for p in (self.dir / "dict").rglob("sys.dic"))
        if hits:
            return hits[0]
        try:   # the dictionary that comes with pyopenjtalk works too
            import pyopenjtalk
            d = pyopenjtalk.OPEN_JTALK_DICT_DIR
            d = Path(d.decode() if isinstance(d, bytes) else d)
            return d if (d / "sys.dic").exists() else None
        except Exception:
            return None

    def vvms(self):
        return sorted((self.dir / "models").glob("*.vvm"))

    def installed(self):
        try:
            importlib.invalidate_caches()
            importlib.import_module("voicevox_core")
        except Exception:
            return False
        return bool(self.ort_lib() and self.dict_dir() and self.vvms())

    def info(self):
        return {"installed": self.installed(), "status": dict(self.status), "total_mb": TOTAL_MB,
                "voices": self.voices or KNOWN_VOICES, "default": DEFAULT_STYLE, "terms": TERMS_URL}

    # ----- install -----
    def _download(self, url, dest, done_mb):
        part = dest.with_name(dest.name + ".part")
        have = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(url, headers={"User-Agent": "japanese-tutor-voice",
                                                   **({"Range": f"bytes={have}-"} if have else {})})
        start, window = time.time(), []
        with urllib.request.urlopen(req, timeout=45) as r:
            if have and r.status != 206:
                have = 0
            with open(part, "ab" if have else "wb") as f:
                while True:
                    if self.cancel:
                        raise Cancelled()
                    try:
                        chunk = r.read(1 << 20)
                    except TimeoutError:
                        raise RuntimeError("no data for 45 seconds (internet connection dropped or very slow)")
                    if not chunk:
                        break
                    f.write(chunk)
                    have += len(chunk)
                    now = time.time()
                    window.append((now, have))
                    while window and now - window[0][0] > 5:
                        window.pop(0)
                    speed = (window[-1][1] - window[0][1]) / (now - window[0][0]) if now > window[0][0] else 0
                    mb = done_mb + have / 1e6
                    self.status.update(mb=round(mb), mbps=round(speed / 1e6, 1),
                                       eta_s=round((TOTAL_MB - mb) * 1e6 / speed) if speed > 0 and TOTAL_MB > mb else None)
        os.replace(part, dest)

    def _install_wheel(self, wheel, venv_py, uv):
        if uv and venv_py and Path(venv_py).exists():
            r = subprocess.run([uv, "pip", "install", "--quiet", "--python", str(venv_py), str(wheel)],
                               capture_output=True, text=True)
            if r.returncode == 0:
                return
            self.log("uv couldn't install VOICEVOX, unpacking it directly:", r.stderr.strip()[-300:])
        # Fallback: the wheel is a zip; unpack it where this helper can import it.
        shutil.rmtree(self.pylib, ignore_errors=True)
        self.pylib.mkdir(parents=True)
        with zipfile.ZipFile(wheel) as z:
            z.extractall(self.pylib)
        if str(self.pylib) not in sys.path:
            sys.path.insert(0, str(self.pylib))

    def install(self, venv_py=None, uv=None):
        self.cancel = False
        self.status.update(state="running", step="Starting", mb=0, error="", mbps=0.0, eta_s=None)
        dl = self.dir / "downloads"
        dl.mkdir(parents=True, exist_ok=True)
        try:
            done = 0
            for label, url, name, mb in DOWNLOADS:
                self.status["step"] = f"Downloading {label}"
                dest = dl / name
                if not dest.exists():
                    self.log(f"VOICEVOX: downloading {url}")
                    try:
                        self._download(url, dest, done)
                    except Cancelled:
                        raise
                    except Exception as e:
                        if name != "dict.tar.gz" or not self.dict_dir():
                            raise RuntimeError(f"downloading {label} failed: {e}")
                        self.log("VOICEVOX: dictionary download failed, using pyopenjtalk's:", repr(e))
                done += mb
                self.status["mb"] = done
            self.status["step"] = "Installing"
            self._install_wheel(dl / WHEEL, venv_py, uv)
            for name, sub in (("onnxruntime.tgz", "onnxruntime"), ("dict.tar.gz", "dict")):
                if not (dl / name).exists():
                    continue
                target = self.dir / sub
                shutil.rmtree(target, ignore_errors=True)
                target.mkdir(parents=True)
                with tarfile.open(dl / name) as t:
                    for m in t.getmembers():
                        if m.name.startswith("/") or ".." in m.name.split("/") or not (m.isfile() or m.isdir()):
                            continue
                        t.extract(m, target)
            models = self.dir / "models"
            models.mkdir(exist_ok=True)
            for _l, _u, name, _mb in DOWNLOADS:
                if name.endswith(".vvm"):
                    shutil.copy2(dl / name, models / name)
            if not self.ort_lib():
                raise RuntimeError("the speech engine library wasn't in the download")
            if not self.dict_dir():
                raise RuntimeError("the Japanese dictionary wasn't in the download")
            self.status["step"] = "Loading the voices"
            self.load()
            shutil.rmtree(dl, ignore_errors=True)
            self.status.update(state="done", step="Installed", mbps=0.0, eta_s=None)
            self.log("VOICEVOX installed")
        except Cancelled:
            self.status.update(state="failed", error="Cancelled. Press Install again to continue where it stopped.")
        except Exception as e:
            self.log("VOICEVOX install failed:", repr(e))
            self.status.update(state="failed", error=f"Couldn't install VOICEVOX: {e}")

    # ----- speaking -----
    def load(self):
        with self.lock:
            if self.synth is not None:
                return self.synth
            importlib.invalidate_caches()
            from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
            t = time.time()
            ort = Onnxruntime.load_once(filename=str(self.ort_lib()))
            ojt = OpenJtalk(str(self.dict_dir()))
            try:
                synth = Synthesizer(ort, ojt, cpu_num_threads=max(1, (os.cpu_count() or 2) - 1))
            except TypeError:
                synth = Synthesizer(ort, ojt)
            for vvm in self.vvms():
                with VoiceModelFile.open(str(vvm)) as model:
                    synth.load_voice_model(model)
            voices = []
            try:
                for ch in synth.metas():
                    for st in ch.styles:
                        if getattr(st, "type", "talk") in ("talk", None):
                            voices.append({"id": st.id, "name": ch.name, "style": st.name})
            except Exception as e:
                self.log("VOICEVOX: couldn't list voices:", repr(e))
            self.voices = voices
            self.synth = synth
            self.log(f"VOICEVOX ready in {time.time() - t:.1f}s ({len(voices)} voices)")
            return synth

    def tts(self, text, style_id, speed):
        synth = self.load()
        ids = {v["id"] for v in self.voices}
        if ids and style_id not in ids:
            style_id = DEFAULT_STYLE if DEFAULT_STYLE in ids else sorted(ids)[0]
        with self.lock:
            q = synth.create_audio_query(text, style_id)
            q.speed_scale = max(0.5, min(2.0, speed))
            q.pre_phoneme_length = 0.05
            q.post_phoneme_length = 0.1
            return synth.synthesis(q, style_id)
