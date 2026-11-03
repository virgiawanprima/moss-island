import sys
import os
import re
import json
import math
import time
import random
import asyncio
import threading
import ctypes
import urllib.parse
import urllib.request
import webbrowser
from ctypes import wintypes
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import psutil
except ImportError:
    psutil = None

# Deteksi & kontrol musik lewat Windows Media Controls (SMTC): semua App & Browser
try:
    from winrt.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlayStatus,
    )
    from winrt.windows.storage.streams import Buffer, DataReader, InputStreamOptions
    WINRT_OK = True
except Exception:
    WINRT_OK = False

try:
    from winrt.windows.media import MediaPlaybackAutoRepeatMode
    REPEAT_ENUM_OK = True
except Exception:
    REPEAT_ENUM_OK = False

from PyQt6.QtCore import (
    Qt, QTimer, QVariantAnimation, QEasingCurve, QRect, QRectF,
    QPointF, QSize, QFileInfo, pyqtSignal, QPropertyAnimation
)
from PyQt6.QtGui import (
    QColor, QFont, QFontDatabase, QFontMetrics, QPainter, QPainterPath,
    QLinearGradient, QRadialGradient, QBrush, QPen, QIcon, QPixmap, QAction,
    QCursor, QRegion
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel,
    QPushButton, QLineEdit, QListWidget, QListWidgetItem, QTextEdit,
    QProgressBar, QStackedWidget, QSystemTrayIcon, QMenu,
    QGraphicsOpacityEffect, QSizePolicy, QFrame, QStyledItemDelegate,
    QStyle, QFileIconProvider, QScrollArea, QFileDialog, QColorDialog, QInputDialog
)

# ───────────────────────── Konstanta ─────────────────────────
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_PLAY_PAUSE = 0xB3

DATA_FILE = Path.home() / ".flow_island_pro_skripsi.json"
STARTUP_BAT = Path(os.path.expandvars(
    r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FlowIslandSkripsi.bat"
))

# Skala seluruh UI (1.0 = ukuran lama). 0.7 → panjang & lebar 70%, luas tinggal ±setengah.
UI_SCALES = {"Kecil": 0.6, "Sedang": 0.7, "Besar": 0.85, "Normal": 1.0}
DEFAULT_SCALE = 0.95
UI_SCALE = DEFAULT_SCALE


def load_ui_scale():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            v = float(json.load(f).get("ui_scale", DEFAULT_SCALE))
        return max(0.5, min(1.5, v))
    except Exception:
        return DEFAULT_SCALE


M = 18      # margin transparan bayangan (lebih ramping)
EAR = 9     # radius lengkung telinga atas (lebih tipis & minimalis)

TXT2 = "rgba(255,255,255,0.55)"

FONT_STYLES = {
    "Modern":    {"display": ["Inter Display", "Inter", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI"],
                  "body":    ["Inter", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Arial"],
                  "num":     ["Inter", "Bahnschrift", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI"]},
    "Geometris": {"display": ["Montserrat", "Century Gothic", "Bahnschrift", "Segoe UI"],
                  "body":    ["Poppins", "Century Gothic", "Segoe UI", "Arial"],
                  "num":     ["Bahnschrift", "Montserrat", "Century Gothic", "Segoe UI"]},
    "Lembut":    {"display": ["SF Pro Rounded", "Nunito", "Quicksand", "Varela Round", "Segoe UI Variable Display", "Segoe UI"],
                  "body":    ["Nunito", "Quicksand", "Varela Round", "Segoe UI Variable Text", "Segoe UI"],
                  "num":     ["Nunito", "Quicksand", "Segoe UI"]},
    "Editorial": {"display": ["Playfair Display", "Cambria", "Georgia", "Segoe UI"],
                  "body":    ["Segoe UI Variable Text", "Segoe UI", "Arial"],
                  "num":     ["Playfair Display", "Cambria", "Georgia", "Segoe UI"]},
    "Teknis":    {"display": ["JetBrains Mono", "Cascadia Code", "Consolas", "Segoe UI"],
                  "body":    ["Cascadia Mono", "Consolas", "Segoe UI", "Arial"],
                  "num":     ["JetBrains Mono", "Cascadia Mono", "Consolas"]},
}
FONT_STYLE = "Modern"
FONT_FAMILIES = FONT_STYLES["Modern"]["body"]
NUM_FAMILIES = FONT_STYLES["Modern"]["num"]
DISPLAY_FAMILIES = FONT_STYLES["Modern"]["display"]


def load_font_style():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            name = json.load(f).get("font_style", "Modern")
        return name if name in FONT_STYLES else "Modern"
    except Exception:
        return "Modern"


def set_font_style_global(name):
    global FONT_STYLE, FONT_FAMILIES, NUM_FAMILIES, DISPLAY_FAMILIES
    st = FONT_STYLES.get(name, FONT_STYLES["Modern"])
    FONT_STYLE = name if name in FONT_STYLES else "Modern"
    FONT_FAMILIES, NUM_FAMILIES, DISPLAY_FAMILIES = st["body"], st["num"], st["display"]
ICON_FONT = None

THEMES = {
    "Klasik":   {"bg1": "#000000", "bg2": "#000000", "accent": "#0A84FF", "orn": "dots"},
    "Midnight": {"bg1": "#050816", "bg2": "#12204F", "accent": "#6AA3FF", "orn": "stars"},
    "Aurora":   {"bg1": "#031A1F", "bg2": "#1E0C3F", "accent": "#2EE6C5", "orn": "orbs"},
    "Sunset":   {"bg1": "#1A0805", "bg2": "#3A112B", "accent": "#FF8A3D", "orn": "rings"},
    "Sakura":   {"bg1": "#1D0A15", "bg2": "#38142E", "accent": "#FF7EB6", "orn": "petals"},
    "Forest":   {"bg1": "#030F08", "bg2": "#0E301B", "accent": "#4ADE80", "orn": "lines"},
    "Violet":   {"bg1": "#0B0520", "bg2": "#2E1468", "accent": "#A78BFA", "orn": "shapes"},
    "Kustom":   {"bg1": "#0B1020", "bg2": "#241455", "accent": "#7C5CFF", "orn": "orbs"},
}

_rng = random.Random(11)
STARS = [(_rng.random(), _rng.random(), _rng.choice((1.2, 1.6, 2.0))) for _ in range(26)]
SPARKLES = [(0.91, 0.20, 7), (0.76, 0.74, 5), (0.56, 0.12, 4)]

ICONS = {
    "play": ("\uE768", "▶"), "pause": ("\uE769", "❚❚"),
    "prev": ("\uE892", "⏮"), "next": ("\uE893", "⏭"),
    "repeat": ("\uE8EE", "↻"), "repeat_one": ("\uE8ED", "↻¹"),
    "lyrics": ("\uE90B", "❝"),
    "mute": ("\uE74F", "×"), "vol_down": ("\uE993", "−"), "vol_up": ("\uE995", "+"),
    "home": ("\uE80F", "♫"), "todo": ("\uE73A", "✓"), "note": ("\uE70B", "✎"),
    "clip": ("\uE77F", "▤"), "apps": ("\uE71D", "⊞"), "focus": ("\uE916", "◔"),
    "pin": ("\uE718", "⌖"), "snip": ("\uE722", "▣"), "more": ("\uE712", "⋯"),
    "open": ("\uE8A7", "↗"), "add": ("\uE710", "+"), "trash": ("\uE74D", "✕"),
}

BROWSER_PROCS = ("chrome.exe", "msedge.exe", "brave.exe", "firefox.exe", "opera.exe", "vivaldi.exe", "arc.exe")


def clamp01(v):
    return max(0.0, min(1.0, v))


def rgba(hexcolor, a):
    c = QColor(hexcolor)
    return f"rgba({c.red()},{c.green()},{c.blue()},{a})"


def fmt_sec(sec):
    sec = max(0, int(sec or 0))
    m, s = divmod(sec, 60)
    return f"{m:02d}:{s:02d}"


def make_font(px, weight=QFont.Weight.Normal, tracking=0.0, numeric=False):
    f = QFont()
    if numeric:
        f.setFamilies(NUM_FAMILIES)
    elif px >= 17:
        f.setFamilies(DISPLAY_FAMILIES)      # judul & angka besar memakai font display
    else:
        f.setFamilies(FONT_FAMILIES)
    f.setPixelSize(px)
    f.setWeight(weight)
    if not tracking and px >= 17:
        tracking = -0.02 * px                # huruf besar dirapatkan agar terlihat modern
    if tracking:
        f.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, tracking)
    return f


def pick_icon_font():
    fams = QFontDatabase.families()
    for name in ("Segoe Fluent Icons", "Segoe MDL2 Assets"):
        if name in fams:
            return name
    return None


def load_custom_fonts():
    dirs = []
    if getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).parent / "fonts")
        dirs.append(Path(getattr(sys, "_MEIPASS", ".")) / "fonts")
    dirs.append(Path(__file__).resolve().parent / "fonts")
    for d in dirs:
        if d.is_dir():
            for f in list(d.glob("*.ttf")) + list(d.glob("*.otf")):
                QFontDatabase.addApplicationFont(str(f))


def theme_icon(th, active):
    pm = QPixmap(20, 20)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    g = QLinearGradient(0, 0, 20, 20)
    g.setColorAt(0, QColor(th["accent"]))
    g.setColorAt(1, QColor(th["bg2"]))
    p.setBrush(QBrush(g))
    p.setPen(QPen(QColor(255, 255, 255, 235), 2) if active else QPen(QColor(255, 255, 255, 50), 1))
    p.drawEllipse(2, 2, 16, 16)
    p.end()
    return QIcon(pm)


def sparkle_path(cx, cy, r):
    k = r * 0.22
    path = QPainterPath()
    pts = [(0, -r), (k, -k), (r, 0), (k, k), (0, r), (-k, k), (-r, 0), (-k, -k)]
    path.moveTo(cx + pts[0][0], cy + pts[0][1])
    for x, y in pts[1:]:
        path.lineTo(cx + x, cy + y)
    path.closeSubpath()
    return path


# ───────────────────────── Windows Helper ─────────────────────────
class SYSTEM_POWER_STATUS(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", wintypes.DWORD),
        ("BatteryFullLifeTime", wintypes.DWORD),
    ]


def get_battery_info():
    status = SYSTEM_POWER_STATUS()
    if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
        percent = status.BatteryLifePercent
        if percent > 100:
            percent = 100
        return percent, status.ACLineStatus == 1
    return 100, False


def is_browser_foreground():
    """Mendeteksi apakah jendela yang sedang aktif di layar adalah Chrome / Browser."""
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return False
    if psutil:
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            name = psutil.Process(pid.value).name().lower()
            if name in BROWSER_PROCS:
                return True
        except Exception:
            pass
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        t = buf.value.lower()
        if any(b in t for b in ("google chrome", "microsoft edge", "brave", "mozilla firefox", "opera", "vivaldi")):
            return True
    return False


def detect_playing_media():
    """Fallback universal untuk mendeteksi judul lagu dari berbagai pemutar musik bila WinRT tidak aktif."""
    user32 = ctypes.windll.user32
    found = {}
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def enum_proc(hwnd, lParam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.strip()

        for tag in (" - YouTube Music", " - YouTube", " | Spotify"):
            idx = title.find(tag)
            if idx > 0:
                clean = title[:idx].strip()
                if clean:
                    found["Browser"] = (clean, "Browser Media")
                    return True

        if psutil and " - " in title:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            try:
                pname = psutil.Process(pid.value).name().lower()
                if pname in ("spotify.exe", "music.ui.exe", "applemusic.exe", "vlc.exe", "foobar2000.exe", "aimp.exe", "wmplayer.exe"):
                    p1, p2 = title.split(" - ", 1)
                    label_app = "Spotify" if "spotify" in pname else pname.replace(".exe", "").title()
                    found[label_app] = (p2.strip(), p1.strip())
            except Exception:
                pass
        return True

    user32.EnumWindows(WNDENUMPROC(enum_proc), 0)
    return found


# ───────────────────────── Media & Lyrics Bridge ─────────────────────────
class MediaBridge(threading.Thread):
    """Membaca & mengontrol SEMUA pemutar musik (App & Browser) beserta durasi real-time."""

    BROWSERS = ("chrome", "msedge", "edge", "brave", "firefox", "opera", "vivaldi", "arc")

    def __init__(self):
        super().__init__(daemon=True)
        self.available = WINRT_OK
        self.prefer = "Semua"  # "Semua", "Spotify", "Browser"
        self._state = None
        self._lock = threading.Lock()
        self._loop = None
        self._mgr = None
        self._thumbs = {}

    @classmethod
    def kind_of(cls, app_id):
        a = (app_id or "").lower()
        if "spotify" in a:
            return "Spotify"
        if any(b in a for b in cls.BROWSERS):
            return "Browser"
        if "apple" in a or "itunes" in a:
            return "Apple Music"
        if "zune" in a or "music.ui" in a or "microsoft.media" in a:
            return "Media Player"
        if "vlc" in a:
            return "VLC"
        if "foobar" in a:
            return "Foobar2000"
        if "aimp" in a:
            return "AIMP"
        clean = os.path.basename(a).replace(".exe", "").split("!")[0]
        return clean.title() if clean else "Media App"

    def get_state(self):
        with self._lock:
            return None if self._state is None else dict(self._state)

    def run(self):
        if not self.available:
            return
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._main())
        except Exception:
            self.available = False

    async def _main(self):
        self._mgr = await MediaManager.request_async()
        while True:
            try:
                await self._refresh()
            except Exception:
                pass
            await asyncio.sleep(0.6)

    def _pick(self):
        sessions = list(self._mgr.get_sessions())
        if not sessions:
            return None
        scored = []
        for s in sessions:
            try:
                playing = s.get_playback_info().playback_status == PlayStatus.PLAYING
            except Exception:
                playing = False
            kind = self.kind_of(s.source_app_user_model_id)
            if self.prefer == "Semua":
                match = True
            elif self.prefer == "Browser":
                match = (kind == "Browser")
            else:
                match = (kind == self.prefer)
            scored.append((playing, match, s))
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return scored[0][2]

    async def _read_thumb(self, ref):
        stream = await ref.open_read_async()
        size = int(stream.size)
        if size <= 0 or size > 8_000_000:
            return b""
        buf = Buffer(size)
        await stream.read_async(buf, size, InputStreamOptions.READ_AHEAD)
        reader = DataReader.from_buffer(buf)
        data = bytearray(reader.unconsumed_buffer_length)
        reader.read_bytes(data)
        return bytes(data)

    async def _refresh(self):
        s = self._pick()
        if s is None:
            with self._lock:
                self._state = None
            return
        info = await s.try_get_media_properties_async()
        pb = s.get_playback_info()
        playing = pb.playback_status == PlayStatus.PLAYING

        pos_sec, dur_sec, has_tl = 0.0, 0.0, False
        try:
            tl = s.get_timeline_properties()
            if tl:
                start = tl.start_time.total_seconds()
                end = tl.end_time.total_seconds()
                dur_sec = max(0.0, end - start)
                pos_sec = max(0.0, tl.position.total_seconds() - start)
                has_tl = dur_sec > 0
                if playing and has_tl:
                    # Windows hanya menyimpan posisi pada saat last_updated_time:
                    # posisi sebenarnya = posisi tersimpan + waktu yang sudah berlalu.
                    try:
                        lu = tl.last_updated_time
                        if lu.tzinfo is None:
                            lu = lu.replace(tzinfo=timezone.utc)
                        age = (datetime.now(timezone.utc) - lu).total_seconds()
                        rate = 1.0
                        try:
                            r = pb.playback_rate
                            rate = float(r) if r else 1.0
                        except Exception:
                            pass
                        if 0.0 <= age < 900.0:
                            pos_sec += age * rate
                    except Exception:
                        pass
                if dur_sec > 0:
                    pos_sec = min(pos_sec, dur_sec)
        except Exception:
            pass

        repeat_ok, repeat = False, 0
        try:
            repeat_ok = bool(pb.controls.is_repeat_enabled)
            mode = pb.auto_repeat_mode
            repeat = int(mode) if mode is not None else 0
        except Exception:
            pass

        title, artist = info.title or "", info.artist or ""
        key = (title, artist)
        thumb = self._thumbs.get(key, b"")
        if not thumb and info.thumbnail is not None:
            try:
                thumb = await self._read_thumb(info.thumbnail)
            except Exception:
                thumb = b""
            if thumb:
                if len(self._thumbs) > 6:
                    self._thumbs.clear()
                self._thumbs[key] = thumb

        with self._lock:
            self._state = {
                "title": title, "artist": artist, "playing": playing,
                "source": self.kind_of(s.source_app_user_model_id), "thumb": thumb,
                "repeat": repeat, "repeat_ok": repeat_ok,
                "position": pos_sec, "duration": dur_sec, "has_timeline": has_tl,
                "sampled_at": time.monotonic(),
            }

    def command(self, name, val=None):
        if not (self.available and self._loop and self._mgr):
            return False
        asyncio.run_coroutine_threadsafe(self._do(name, val), self._loop)
        return True

    async def _do(self, name, val=None):
        try:
            s = self._pick()
            if s is None:
                return
            if name == "toggle":
                await s.try_toggle_play_pause_async()
            elif name == "play":
                await s.try_play_async()
            elif name == "pause":
                await s.try_pause_async()
            elif name == "next":
                await s.try_skip_next_async()
            elif name == "prev":
                await s.try_skip_previous_async()
            elif name == "seek" and val is not None:
                ticks = int(float(val) * 10_000_000)
                await s.try_change_playback_position_async(ticks)
            elif name == "repeat" and REPEAT_ENUM_OK:
                cur = s.get_playback_info().auto_repeat_mode
                cur = int(cur) if cur is not None else 0
                nxt = {0: 2, 2: 1, 1: 0}.get(cur, 0)
                await s.try_change_auto_repeat_mode_async(MediaPlaybackAutoRepeatMode(nxt))
        except Exception:
            pass


class LyricsFetcher(threading.Thread):
    """Mengambil lirik sinkron (LRC) dari LRCLIB; memilih versi yang durasinya paling cocok."""

    def __init__(self):
        super().__init__(daemon=True)
        self._req_key = None
        self._loaded_key = None
        self._dur = 0.0
        self._loaded_dur = 0.0
        self._lines = []
        self._status = "Putar lagu untuk memuat lirik"
        self._lock = threading.Lock()

    @staticmethod
    def clean(title, artist):
        t = title or ""
        a = artist or ""
        t = re.sub(r"\(.*?\)|\[.*?\]|【.*?】", "", t)
        t = re.sub(r"(?i)\b(official\s*(music\s*)?(video|audio|lyric video)|lyrics?|audio|hd|hq|mv)\b", "", t)
        t = re.sub(r"(?i)\s*(feat\.?|ft\.?)\s.*$", "", t)
        t = re.sub(r"\s{2,}", " ", t).strip(" -–|")
        a = re.sub(r"(?i)\s*-\s*topic$", "", a)
        a = re.split(r",|&|;", a)[0].strip()
        if (not a or a == "Browser Media") and " - " in t:
            a, t = [x.strip() for x in t.split(" - ", 1)]
        if a == "Browser Media":
            a = ""
        return t, a

    def request_track(self, title, artist, duration=0.0):
        t, a = self.clean(title, artist)
        with self._lock:
            self._req_key = (t, a) if t else None
            self._dur = float(duration or 0.0)

    def get_lyrics(self):
        with self._lock:
            if self._req_key != self._loaded_key:
                return [], ("Mencari lirik…" if self._req_key else "Putar lagu untuk memuat lirik")
            return list(self._lines), self._status

    def run(self):
        while True:
            time.sleep(0.5)
            with self._lock:
                req, loaded = self._req_key, self._loaded_key
                dur, ldur = self._dur, self._loaded_dur
            new_track = req != loaded
            refine = bool(req) and not new_track and dur > 0 and ldur == 0
            if not (new_track or refine):
                continue
            if not req:
                with self._lock:
                    self._loaded_key = req
                    self._lines = []
                    self._status = "Putar lagu untuk memuat lirik"
                continue

            lines, status = self._fetch(req[0], req[1], dur)
            with self._lock:
                if self._req_key != req:
                    continue
                self._loaded_key = req
                self._loaded_dur = dur
                self._lines = lines
                self._status = status

    def _get_json(self, url):
        r = urllib.request.Request(url, headers={"User-Agent": "FlowIslandPro/2.1"})
        with urllib.request.urlopen(r, timeout=6) as resp:
            return json.loads(resp.read().decode("utf-8", errors="ignore"))

    def _fetch(self, title, artist, dur):
        items, ok_calls = [], 0
        base = "https://lrclib.net/api/"
        if dur > 0 and artist:
            try:
                q = urllib.parse.urlencode({"track_name": title, "artist_name": artist,
                                            "duration": int(round(dur))})
                d = self._get_json(base + "get?" + q)
                ok_calls += 1
                if isinstance(d, dict) and (d.get("syncedLyrics") or d.get("plainLyrics")):
                    items = [d]
            except Exception:
                pass
        if not items:
            tries = []
            if artist:
                tries.append({"track_name": title, "artist_name": artist})
            tries.append({"q": f"{title} {artist}".strip()})
            for params in tries:
                try:
                    res = self._get_json(base + "search?" + urllib.parse.urlencode(params))
                    ok_calls += 1
                except Exception:
                    continue
                if isinstance(res, list) and res:
                    items = res
                    break
        if not items:
            return [], ("Lirik belum tersedia untuk lagu ini" if ok_calls else "Gagal memuat lirik (cek koneksi)")

        cands = [it for it in items if isinstance(it, dict)]

        def score(it):
            no_sync = 0 if it.get("syncedLyrics") else 1
            try:
                d = abs(float(it.get("duration") or 0) - dur) if (dur > 0 and it.get("duration")) else 999.0
            except Exception:
                d = 999.0
            return (no_sync, d)

        best = min(cands, key=score)
        if best.get("syncedLyrics"):
            parsed = self._parse_lrc(best["syncedLyrics"])
            if parsed:
                return parsed, "synced"
        if best.get("plainLyrics"):
            plain = [ln.strip() for ln in best["plainLyrics"].splitlines() if ln.strip()]
            if plain:
                step = (dur / len(plain)) if dur > 0 else 4.0
                return [(i * step, ln) for i, ln in enumerate(plain)], "plain"
        return [], "Lirik tidak ditemukan"

    @staticmethod
    def _parse_lrc(lrc_text):
        out = []
        stamp = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
        for line in lrc_text.splitlines():
            stamps = stamp.findall(line)
            if not stamps:
                continue
            txt = re.sub(r"\[[^\]]*\]", "", line).strip() or "♪"
            for m, s in stamps:
                out.append((int(m) * 60 + float(s), txt))
        out.sort(key=lambda x: x[0])
        return out


def create_app_icon():
    pix = QPixmap(64, 64)
    pix.fill(Qt.GlobalColor.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setBrush(QBrush(QColor("#000000")))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawRoundedRect(6, 18, 52, 28, 14, 14)
    p.setBrush(QBrush(QColor("#30D158")))
    p.drawEllipse(40, 27, 10, 10)
    p.end()
    return QIcon(pix)


# ───────────────────────── Widget Kustom Baru ─────────────────────────
class BlinkingEyesWidget(QWidget):
    """Animasi mata berkedip & melirik kursor secara dinamis ketika Chrome/Browser dibuka."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(46, 18)
        self.accent = QColor("#0A84FF")
        self.blink_openness = 1.0  # 1.0 = terbuka, 0.0 = tertutup
        self.blink_phase = 0
        self.next_blink = time.monotonic() + 2.2
        self.squint_mode = False
        self.squint_until = 0.0
        self.look_x = 0.0
        self.look_y = 0.0

    def step(self):
        if not self.isVisible():
            return
        now = time.monotonic()

        cpos = QCursor.pos()
        gpos = self.mapToGlobal(self.rect().center())
        dx = max(-1.0, min(1.0, (cpos.x() - gpos.x()) / 380.0))
        dy = max(-1.0, min(1.0, (cpos.y() - gpos.y()) / 280.0))
        self.look_x += (dx - self.look_x) * 0.35
        self.look_y += (dy - self.look_y) * 0.35

        if self.blink_phase == 0 and now >= self.next_blink:
            self.blink_phase = 1
            if random.random() < 0.18:
                self.squint_mode = True
                self.squint_until = now + 1.1

        if self.blink_phase == 1:
            self.blink_openness -= 0.42
            if self.blink_openness <= 0.0:
                self.blink_openness = 0.0
                self.blink_phase = 2
        elif self.blink_phase == 2:
            self.blink_openness += 0.35
            if self.blink_openness >= 1.0:
                self.blink_openness = 1.0
                if random.random() < 0.30:
                    self.blink_phase = 1
                else:
                    self.blink_phase = 0
                    self.next_blink = now + random.uniform(1.8, 4.2)

        if self.squint_mode and now > self.squint_until:
            self.squint_mode = False

        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        cx1, cx2 = 14.0, 32.0
        cy = self.height() / 2.0
        ew, eh = 9.0, 10.5 * self.blink_openness

        for cx in (cx1, cx2):
            ox = cx + self.look_x * 2.8
            oy = cy + self.look_y * 1.8

            if self.squint_mode and self.blink_openness > 0.5:
                pen = QPen(QColor(255, 255, 255, 245), 2.2)
                pen.setCapStyle(Qt.PenCapStyle.RoundCap)
                p.setPen(pen)
                p.setBrush(Qt.BrushStyle.NoBrush)
                arc_rect = QRectF(ox - 4.5, oy - 3.0, 9.0, 7.0)
                p.drawArc(arc_rect, 20 * 16, 140 * 16)
            elif eh <= 1.8:
                pen = QPen(self.accent, 2.0)
                pen.setCapStyle(Qt.PenCapStyle.RoundCap)
                p.setPen(pen)
                p.drawLine(QPointF(ox - 4.5, oy), QPointF(ox + 4.5, oy))
            else:
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QColor(255, 255, 255, 245))
                p.drawRoundedRect(QRectF(ox - ew / 2, oy - eh / 2, ew, eh), ew / 2, ew / 2)

                p.setBrush(self.accent)
                ir = min(4.2, eh * 0.45)
                p.drawEllipse(QPointF(ox + self.look_x * 1.1, oy + self.look_y * 0.8), ir, ir)

                p.setBrush(QColor(255, 255, 255, 250))
                p.drawEllipse(QPointF(ox - 1.2 + self.look_x * 0.6, oy - 1.5), 1.3, 1.3)


class SeekBar(QWidget):
    """Bar durasi lagu: klik atau geser untuk pindah posisi."""

    seekRequested = pyqtSignal(float)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(16)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.pos_sec = 0.0
        self.dur_sec = 0.0
        self.accent = QColor("#0A84FF")
        self.hover = False
        self.dragging = False

    def set_progress(self, pos_sec, dur_sec):
        self.dur_sec = max(0.0, float(dur_sec))
        if not self.dragging:
            self.pos_sec = max(0.0, float(pos_sec))
        self.update()

    def enterEvent(self, e):
        self.hover = True
        self.update()

    def leaveEvent(self, e):
        self.hover = False
        self.update()

    def _ratio(self, e):
        return clamp01(e.position().x() / max(1, self.width()))

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton and self.dur_sec > 0:
            self.dragging = True
            self.pos_sec = self._ratio(e) * self.dur_sec
            self.update()

    def mouseMoveEvent(self, e):
        if self.dragging:
            self.pos_sec = self._ratio(e) * self.dur_sec
            self.update()

    def mouseReleaseEvent(self, e):
        if self.dragging:
            self.dragging = False
            self.seekRequested.emit(self.pos_sec)

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        w, h = self.width(), self.height()
        active = self.hover or self.dragging
        bh = 5.0 if active else 3.6
        y = (h - bh) / 2.0

        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(255, 255, 255, 36))
        p.drawRoundedRect(QRectF(0, y, w, bh), bh / 2, bh / 2)

        ratio = clamp01(self.pos_sec / self.dur_sec) if self.dur_sec > 0 else 0.0
        fw = w * ratio
        if fw > 1.0:
            p.setBrush(self.accent)
            p.drawRoundedRect(QRectF(0, y, fw, bh), bh / 2, bh / 2)

        if active and self.dur_sec > 0:
            p.setBrush(QColor(255, 255, 255))
            p.drawEllipse(QPointF(max(5.0, min(w - 5.0, fw)), h / 2.0), 5.0, 5.0)


class LyricsView(QWidget):
    """Lirik bergulir halus. Baris panjang DIBUNGKUS ke beberapa baris (tidak dipotong lagi);
    baris aktif membesar & terang, baris lain meredup menurut jaraknya."""

    PAD_X = 14

    def __init__(self, parent=None):
        super().__init__(parent)
        self.lines = []
        self.status = "Putar lagu untuk memuat lirik"
        self.cur_idx = -1
        self.scroll_y = 0.0
        self.target_y = 0.0
        self.accent = QColor("#0A84FF")
        self._sig = None
        self.plain = False
        self.ys, self.hs, self.emph = [], [], []
        self._lw = -1
        self._n = -1
        self.pop = 0.0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._step)

    def showEvent(self, e):
        self._timer.start(16)
        super().showEvent(e)

    def hideEvent(self, e):
        self._timer.stop()
        super().hideEvent(e)

    def _text_w(self):
        return max(40, int(self.width() - 2 * self.PAD_X - 6))

    def _layout(self):
        tw = self._text_w()
        if tw == self._lw and len(self.lines) == self._n and len(self.hs) == len(self.lines):
            return
        fm = QFontMetrics(make_font(13, QFont.Weight.Bold))
        flags = int(Qt.AlignmentFlag.AlignLeft) | int(Qt.TextFlag.TextWordWrap)
        self.ys, self.hs = [], []
        y = 0.0
        for _, txt in self.lines:
            r = fm.boundingRect(QRect(0, 0, tw, 5000), flags, txt or "♪")
            hh = max(r.height(), fm.height()) + 2
            self.ys.append(y)
            self.hs.append(hh)
            y += hh + 12
        self._lw = tw
        self._n = len(self.lines)
        if len(self.emph) != len(self.lines):
            self.emph = [0.0] * len(self.lines)

    def update_state(self, lines, status, pos_sec):
        sig = (len(lines), lines[0] if lines else None)
        new_track = sig != self._sig
        self._sig = sig
        self.lines = lines
        self.status = status
        self.plain = (status == "plain")
        if not lines:
            self.cur_idx = -1
            self.scroll_y = self.target_y = 0.0
            self.emph = []
            self.update()
            return

        self._layout()
        idx = -1
        for i, (t, _) in enumerate(lines):
            if pos_sec >= t - 0.15:
                idx = i
            else:
                break
        if idx != self.cur_idx:
            self.pop = 1.0
        self.cur_idx = idx
        k = max(0, idx)
        if k < len(self.ys):
            self.target_y = self.ys[k] + self.hs[k] / 2.0
        if new_track:
            self.scroll_y = self.target_y
            self.emph = [0.0] * len(lines)

    def _step(self):
        if self.lines and self.hs:
            self.scroll_y += (self.target_y - self.scroll_y) * 0.14
            for i in range(len(self.emph)):
                goal = 1.0 if i == self.cur_idx else 0.0
                self.emph[i] += (goal - self.emph[i]) * 0.2
            self.pop *= 0.88
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        r = QRectF(self.rect())

        if not self.lines:
            p.setPen(QColor(255, 255, 255, 140))
            p.setFont(make_font(12, QFont.Weight.Medium))
            p.drawText(r.adjusted(10, 8, -10, -8),
                       int(Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap), self.status)
            return

        self._layout()
        if len(self.emph) != len(self.lines):
            self.emph = [0.0] * len(self.lines)

        p.save()
        p.setClipRect(r)
        cy = r.height() * 0.44
        tw = self._lw
        p.setFont(make_font(13, QFont.Weight.Bold))
        flags = int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter) | int(Qt.TextFlag.TextWordWrap)
        for i, (_, txt) in enumerate(self.lines):
            hh = self.hs[i]
            center = cy + self.ys[i] + hh / 2.0 - self.scroll_y
            if center < -hh - 30 or center > r.height() + hh + 30:
                continue
            em = self.emph[i]
            edge = clamp01(min(center, r.height() - center) / 34.0)
            alpha = (0.34 + 0.66 * em) * (0.35 + 0.65 * edge)
            sc = 0.93 + 0.12 * em + 0.04 * (self.pop if i == self.cur_idx else 0.0)
            p.save()
            p.translate(self.PAD_X, center)
            p.scale(sc, sc)
            if em > 0.05:
                bar = QColor(self.accent)
                bar.setAlpha(int(255 * em))
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(bar)
                p.drawRoundedRect(QRectF(-9, -hh / 2.0 + 3, 3, hh - 6), 1.5, 1.5)
            p.setPen(QColor(255, 255, 255, int(255 * alpha)))
            p.drawText(QRectF(0, -hh / 2.0, tw, hh), flags, txt or "♪")
            p.restore()
        p.restore()

        if self.plain:
            p.setPen(QColor(255, 255, 255, 90))
            p.setFont(make_font(9, QFont.Weight.Medium))
            p.drawText(QRectF(0, r.height() - 14, r.width(), 14),
                       int(Qt.AlignmentFlag.AlignCenter), "tanpa timestamp · waktu perkiraan")


class LyricsPanel(QFrame):
    """Panel lirik di sisi kanan pemutar, lengkap dengan penyesuaian waktu lirik."""

    offsetChanged = pyqtSignal(float)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("lyr")
        self.setStyleSheet(
            "QFrame#lyr{background:rgba(255,255,255,0.05);"
            "border:1px solid rgba(255,255,255,0.07);border-radius:16px;}")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 8, 12, 8)
        lay.setSpacing(4)

        hdr = QHBoxLayout()
        hdr.setSpacing(4)
        hdr.addWidget(label("LIRIK", 9))
        hdr.addStretch()
        btn_css = ("QPushButton{background:rgba(255,255,255,0.08);color:#fff;border:none;border-radius:10px;}"
                   "QPushButton:hover{background:rgba(255,255,255,0.18);}"
                   "QPushButton:pressed{background:rgba(255,255,255,0.28);}")
        self.btn_slow = QPushButton("−")
        self.btn_fast = QPushButton("+")
        for b, tip, d in ((self.btn_slow, "Lirik lebih lambat (−0,5 dtk)", -0.5),
                          (self.btn_fast, "Lirik lebih cepat (+0,5 dtk)", 0.5)):
            b.setFixedSize(20, 20)
            b.setFont(make_font(12, QFont.Weight.Bold))
            b.setStyleSheet(btn_css)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setToolTip(tip)
            b.clicked.connect(lambda _, dd=d: self.offsetChanged.emit(dd))
        self.lbl_off = QLabel("0.0s")
        self.lbl_off.setFixedWidth(38)
        self.lbl_off.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_off.setFont(make_font(10, QFont.Weight.Medium, numeric=True))
        self.lbl_off.setStyleSheet("color:rgba(255,255,255,0.65);background:transparent;border:none;")
        hdr.addWidget(self.btn_slow)
        hdr.addWidget(self.lbl_off)
        hdr.addWidget(self.btn_fast)
        lay.addLayout(hdr)

        self.view = LyricsView()
        lay.addWidget(self.view, 1)

    def set_accent(self, c):
        self.view.accent = c
        self.view.update()

    def set_offset(self, v):
        self.lbl_off.setText(f"{v:+.1f}s" if abs(v) > 0.01 else "0.0s")

    def update_state(self, lines, status, pos_sec):
        self.view.update_state(lines, status, pos_sec)


# ───────────────────────── Widget Kecil Bawaan ─────────────────────────
def parse_css_color(s):
    s = (s or "").strip()
    if s.startswith("rgb"):
        nums = re.findall(r"[\d.]+", s)
        try:
            r, g, b = (int(float(n)) for n in nums[:3])
            a = float(nums[3]) if len(nums) > 3 else 1.0
            return QColor(r, g, b, int(round(255 * a)))
        except Exception:
            return QColor(255, 255, 255)
    c = QColor(s)
    return c if c.isValid() else QColor(255, 255, 255)


# ───────────────────────── Ikon vektor (digambar sendiri, grid 24×24) ─────────────────────────
def _stroke(col, w=1.9):
    pen = QPen(col, w)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    return pen


def _nofill(p):
    p.setBrush(Qt.BrushStyle.NoBrush)


def _solid(p, col):
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(col)


def _ic_play(p, c, soft, lv):
    path = QPainterPath()
    path.moveTo(8.2, 5.6)
    path.lineTo(18.6, 12)
    path.lineTo(8.2, 18.4)
    path.closeSubpath()
    p.setPen(_stroke(c, 2.4))
    p.setBrush(c)
    p.drawPath(path)


def _ic_pause(p, c, soft, lv):
    _solid(p, c)
    p.drawRoundedRect(QRectF(6.6, 5.2, 3.9, 13.6), 1.7, 1.7)
    p.drawRoundedRect(QRectF(13.5, 5.2, 3.9, 13.6), 1.7, 1.7)


def _ic_prev(p, c, soft, lv):
    _solid(p, c)
    p.drawRoundedRect(QRectF(5.2, 5.6, 2.6, 12.8), 1.3, 1.3)
    path = QPainterPath()
    path.moveTo(18.8, 6.2)
    path.lineTo(10, 12)
    path.lineTo(18.8, 17.8)
    path.closeSubpath()
    p.setPen(_stroke(c, 2.2))
    p.setBrush(c)
    p.drawPath(path)


def _ic_next(p, c, soft, lv):
    _solid(p, c)
    p.drawRoundedRect(QRectF(16.2, 5.6, 2.6, 12.8), 1.3, 1.3)
    path = QPainterPath()
    path.moveTo(5.2, 6.2)
    path.lineTo(14, 12)
    path.lineTo(5.2, 17.8)
    path.closeSubpath()
    p.setPen(_stroke(c, 2.2))
    p.setBrush(c)
    p.drawPath(path)


def _ic_repeat(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    _nofill(p)
    a = QPainterPath()
    a.moveTo(4.8, 11)
    a.lineTo(4.8, 10)
    a.quadTo(4.8, 7, 7.8, 7)
    a.lineTo(19, 7)
    a.moveTo(16, 4)
    a.lineTo(19, 7)
    a.lineTo(16, 10)
    b = QPainterPath()
    b.moveTo(19.2, 13)
    b.lineTo(19.2, 14)
    b.quadTo(19.2, 17, 16.2, 17)
    b.lineTo(5, 17)
    b.moveTo(8, 14)
    b.lineTo(5, 17)
    b.lineTo(8, 20)
    p.drawPath(a)
    p.drawPath(b)


def _ic_repeat_one(p, c, soft, lv):
    _ic_repeat(p, c, soft, lv)
    one = QPainterPath()
    one.moveTo(10.7, 11)
    one.lineTo(12.3, 9.7)
    one.lineTo(12.3, 14.3)
    p.setPen(_stroke(c, 1.6))
    p.drawPath(one)


def _ic_lyrics(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawRoundedRect(QRectF(3.8, 4.6, 16.4, 12.2), 3.8, 3.8)
    _nofill(p)
    tail = QPainterPath()
    tail.moveTo(8.2, 16.8)
    tail.lineTo(8.2, 20.2)
    tail.lineTo(12.4, 16.8)
    p.drawPath(tail)
    p.drawLine(QPointF(7.6, 9.3), QPointF(16.4, 9.3))
    p.drawLine(QPointF(7.6, 12.6), QPointF(13.4, 12.6))


def _speaker(p, c):
    poly = QPainterPath()
    poly.moveTo(3.8, 9.8)
    poly.lineTo(7.6, 9.8)
    poly.lineTo(12, 6.2)
    poly.lineTo(12, 17.8)
    poly.lineTo(7.6, 14.2)
    poly.lineTo(3.8, 14.2)
    poly.closeSubpath()
    p.setPen(_stroke(c, 1.5))
    p.setBrush(c)
    p.drawPath(poly)


def _arc(p, c, r):
    p.setPen(_stroke(c, 1.8))
    _nofill(p)
    p.drawArc(QRectF(11.5 - r, 12 - r, 2 * r, 2 * r), -42 * 16, 84 * 16)


def _ic_vol_down(p, c, soft, lv):
    _speaker(p, c)
    _arc(p, c, 5.0)


def _ic_vol_up(p, c, soft, lv):
    _speaker(p, c)
    _arc(p, c, 5.0)
    _arc(p, c, 8.6)


def _ic_mute(p, c, soft, lv):
    _speaker(p, c)
    p.setPen(_stroke(c, 1.8))
    p.drawLine(QPointF(15.2, 9.6), QPointF(20.4, 14.4))
    p.drawLine(QPointF(20.4, 9.6), QPointF(15.2, 14.4))


def _ic_home(p, c, soft, lv):
    p.setPen(_stroke(c, 1.9))
    _nofill(p)
    roof = QPainterPath()
    roof.moveTo(3.8, 11.4)
    roof.lineTo(12, 4.2)
    roof.lineTo(20.2, 11.4)
    p.drawPath(roof)
    body = QPainterPath()
    body.moveTo(6.2, 10.2)
    body.lineTo(6.2, 18.2)
    body.quadTo(6.2, 19.8, 7.8, 19.8)
    body.lineTo(16.2, 19.8)
    body.quadTo(17.8, 19.8, 17.8, 18.2)
    body.lineTo(17.8, 10.2)
    p.drawPath(body)
    _solid(p, soft)
    p.drawRoundedRect(QRectF(10.2, 13.8, 3.6, 6), 1.5, 1.5)


def _ic_music(p, c, soft, lv):
    _solid(p, c)
    p.drawEllipse(QPointF(7.6, 17.6), 2.7, 2.3)
    p.drawEllipse(QPointF(16.2, 15.8), 2.7, 2.3)
    p.setPen(_stroke(c, 1.9))
    _nofill(p)
    st = QPainterPath()
    st.moveTo(10.2, 17.4)
    st.lineTo(10.2, 6.6)
    st.lineTo(18.8, 4.8)
    st.lineTo(18.8, 15.6)
    p.drawPath(st)
    p.setPen(_stroke(c, 2.6))
    p.drawLine(QPointF(10.2, 8.8), QPointF(18.8, 7))


def _ic_check(p, c, soft, lv):
    p.setPen(_stroke(c, 2.1))
    _nofill(p)
    ch = QPainterPath()
    ch.moveTo(5.6, 12.6)
    ch.lineTo(10, 17)
    ch.lineTo(18.6, 7.6)
    p.drawPath(ch)


def _ic_todo(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawEllipse(QPointF(12, 12), 8.2, 8.2)
    _nofill(p)
    ch = QPainterPath()
    ch.moveTo(8.2, 12.4)
    ch.lineTo(10.9, 15.1)
    ch.lineTo(16, 9.2)
    p.setPen(_stroke(c, 2.0))
    p.drawPath(ch)


def _ic_note(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawRoundedRect(QRectF(5, 3.8, 14, 16.4), 3.4, 3.4)
    _nofill(p)
    p.drawLine(QPointF(8.6, 9), QPointF(15.4, 9))
    p.drawLine(QPointF(8.6, 12.4), QPointF(15.4, 12.4))
    p.drawLine(QPointF(8.6, 15.8), QPointF(12.6, 15.8))


def _ic_clip(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawRoundedRect(QRectF(5.6, 5.4, 12.8, 15), 3, 3)
    _solid(p, c)
    p.drawRoundedRect(QRectF(9, 3.2, 6, 4.2), 1.8, 1.8)
    p.setPen(_stroke(c, 1.7))
    p.drawLine(QPointF(9, 12), QPointF(15, 12))
    p.drawLine(QPointF(9, 15.4), QPointF(13, 15.4))


def _ic_apps(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    _nofill(p)
    for (x, y), fill in (((4.6, 4.6), False), ((13.4, 4.6), True), ((4.6, 13.4), True), ((13.4, 13.4), False)):
        p.setBrush(soft if fill else Qt.BrushStyle.NoBrush)
        p.drawRoundedRect(QRectF(x, y, 6, 6), 2, 2)


def _ic_focus(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawEllipse(QPointF(12, 13.4), 7.4, 7.4)
    _nofill(p)
    p.drawLine(QPointF(10, 3.6), QPointF(14, 3.6))
    p.drawLine(QPointF(12, 13.4), QPointF(12, 9.4))
    p.drawLine(QPointF(12, 13.4), QPointF(14.6, 14.8))


def _ic_pin(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    path = QPainterPath()
    path.moveTo(9, 4.6)
    path.lineTo(15, 4.6)
    path.lineTo(14.2, 10.2)
    path.lineTo(17.4, 13.2)
    path.lineTo(6.6, 13.2)
    path.lineTo(9.8, 10.2)
    path.closeSubpath()
    p.drawPath(path)
    p.drawLine(QPointF(12, 13.6), QPointF(12, 20))


def _ic_snip(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    _nofill(p)
    for pts in (
        [(4.6, 9), (4.6, 6.6), (4.6, 4.6), (6.6, 4.6), (9, 4.6)],
        [(15, 4.6), (17.4, 4.6), (19.4, 4.6), (19.4, 6.6), (19.4, 9)],
        [(4.6, 15), (4.6, 17.4), (4.6, 19.4), (6.6, 19.4), (9, 19.4)],
        [(15, 19.4), (17.4, 19.4), (19.4, 19.4), (19.4, 17.4), (19.4, 15)],
    ):
        path = QPainterPath()
        path.moveTo(*pts[0])
        path.lineTo(*pts[1])
        path.quadTo(*pts[2], *pts[3])
        path.lineTo(*pts[4])
        p.drawPath(path)
    _solid(p, c)
    p.drawEllipse(QPointF(12, 12), 1.7, 1.7)


def _ic_more(p, c, soft, lv):
    _solid(p, c)
    for x in (6, 12, 18):
        p.drawEllipse(QPointF(x, 12), 1.8, 1.8)


def _ic_open(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    _nofill(p)
    box = QPainterPath()
    box.moveTo(10, 7)
    box.lineTo(7, 7)
    box.quadTo(4.8, 7, 4.8, 9.2)
    box.lineTo(4.8, 17)
    box.quadTo(4.8, 19.2, 7, 19.2)
    box.lineTo(14.8, 19.2)
    box.quadTo(17, 19.2, 17, 17)
    box.lineTo(17, 14)
    p.drawPath(box)
    p.drawLine(QPointF(13.2, 4.8), QPointF(19.2, 4.8))
    p.drawLine(QPointF(19.2, 4.8), QPointF(19.2, 10.8))
    p.drawLine(QPointF(19.2, 4.8), QPointF(10.6, 13.4))


def _ic_add(p, c, soft, lv):
    p.setPen(_stroke(c, 2.0))
    p.drawLine(QPointF(12, 5.4), QPointF(12, 18.6))
    p.drawLine(QPointF(5.4, 12), QPointF(18.6, 12))


def _ic_trash(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    bin_ = QPainterPath()
    bin_.moveTo(6.8, 7.4)
    bin_.lineTo(7.7, 18.6)
    bin_.quadTo(7.8, 20, 9.2, 20)
    bin_.lineTo(14.8, 20)
    bin_.quadTo(16.2, 20, 16.3, 18.6)
    bin_.lineTo(17.2, 7.4)
    p.drawPath(bin_)
    _nofill(p)
    p.drawLine(QPointF(4.8, 7), QPointF(19.2, 7))
    hd = QPainterPath()
    hd.moveTo(9.5, 7)
    hd.lineTo(9.5, 5.4)
    hd.quadTo(9.5, 4.6, 10.3, 4.6)
    hd.lineTo(13.7, 4.6)
    hd.quadTo(14.5, 4.6, 14.5, 5.4)
    hd.lineTo(14.5, 7)
    p.drawPath(hd)
    p.drawLine(QPointF(10.4, 10.4), QPointF(10.4, 16.4))
    p.drawLine(QPointF(13.6, 10.4), QPointF(13.6, 16.4))


def _ic_sun(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawEllipse(QPointF(12, 12), 4.3, 4.3)
    for i in range(8):
        a = math.radians(i * 45)
        p.drawLine(QPointF(12 + 7.3 * math.cos(a), 12 + 7.3 * math.sin(a)),
                   QPointF(12 + 9.7 * math.cos(a), 12 + 9.7 * math.sin(a)))


def _ic_moon(p, c, soft, lv):
    full = QPainterPath()
    full.addEllipse(QPointF(12, 12), 8, 8)
    cut = QPainterPath()
    cut.addEllipse(QPointF(16.2, 8.6), 7, 7)
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(full.subtracted(cut))


def _cloud_path(dx=0.0, dy=0.0):
    path = QPainterPath()
    path.addEllipse(QPointF(8.6 + dx, 14.2 + dy), 4.2, 4.2)
    b = QPainterPath()
    b.addEllipse(QPointF(13.4 + dx, 12.2 + dy), 5.2, 5.2)
    c3 = QPainterPath()
    c3.addEllipse(QPointF(17.4 + dx, 15.2 + dy), 3.6, 3.6)
    base = QPainterPath()
    base.addRoundedRect(QRectF(8.6 + dx, 14.2 + dy, 8.8, 4.6), 2, 2)
    return path.united(b).united(c3).united(base)


def _ic_cloud(p, c, soft, lv):
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(_cloud_path(0, -1))


def _ic_cloud_sun(p, c, soft, lv):
    p.setPen(_stroke(c, 1.6))
    p.setBrush(soft)
    p.drawEllipse(QPointF(16.6, 7.4), 3.2, 3.2)
    for i in range(5):
        a = math.radians(-90 + i * 45)
        p.drawLine(QPointF(16.6 + 4.9 * math.cos(a), 7.4 + 4.9 * math.sin(a)),
                   QPointF(16.6 + 6.5 * math.cos(a), 7.4 + 6.5 * math.sin(a)))
    p.setBrush(QColor(0, 0, 0, 0))
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(_cloud_path(-2.6, 2.2))


def _ic_rain(p, c, soft, lv):
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(_cloud_path(0, -3.4))
    for x in (8.6, 12.6, 16.6):
        p.drawLine(QPointF(x, 18.4), QPointF(x - 1.1, 21.4))


def _ic_storm(p, c, soft, lv):
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(_cloud_path(0, -3.4))
    bolt = QPainterPath()
    bolt.moveTo(13, 14.6)
    bolt.lineTo(10, 19)
    bolt.lineTo(12.4, 19)
    bolt.lineTo(11.2, 22.2)
    bolt.lineTo(15, 17.6)
    bolt.lineTo(12.6, 17.6)
    bolt.closeSubpath()
    p.setBrush(c)
    p.drawPath(bolt)


def _ic_fog(p, c, soft, lv):
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawPath(_cloud_path(0, -3.4))
    p.drawLine(QPointF(6, 19.2), QPointF(18, 19.2))
    p.drawLine(QPointF(8.4, 22), QPointF(15.6, 22))


def _ic_battery(p, c, soft, lv):
    lv = 1.0 if lv is None else clamp01(lv)
    p.setPen(_stroke(c, 1.7))
    _nofill(p)
    p.drawRoundedRect(QRectF(2.6, 7.4, 16, 9.4), 2.8, 2.8)
    _solid(p, c)
    p.drawRoundedRect(QRectF(19.8, 10.4, 1.9, 3.4), 0.9, 0.9)
    fw = 11.6 * lv
    if fw > 0.8:
        p.drawRoundedRect(QRectF(4.6, 9.4, fw, 5.4), 1.4, 1.4)


def _ic_bolt(p, c, soft, lv):
    bolt = QPainterPath()
    bolt.moveTo(13.2, 3.4)
    bolt.lineTo(6.4, 13.2)
    bolt.lineTo(11, 13.2)
    bolt.lineTo(10, 20.6)
    bolt.lineTo(17.6, 10.4)
    bolt.lineTo(12.6, 10.4)
    bolt.closeSubpath()
    p.setPen(_stroke(c, 1.4))
    p.setBrush(c)
    p.drawPath(bolt)


def _ic_cpu(p, c, soft, lv):
    p.setPen(_stroke(c, 1.7))
    p.setBrush(soft)
    p.drawRoundedRect(QRectF(7, 7, 10, 10), 2.4, 2.4)
    _nofill(p)
    for v in (9.6, 12, 14.4):
        p.drawLine(QPointF(v, 3.8), QPointF(v, 7))
        p.drawLine(QPointF(v, 17), QPointF(v, 20.2))
        p.drawLine(QPointF(3.8, v), QPointF(7, v))
        p.drawLine(QPointF(17, v), QPointF(20.2, v))


def _ic_calendar(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawRoundedRect(QRectF(4, 5.6, 16, 14.6), 3.4, 3.4)
    _nofill(p)
    p.drawLine(QPointF(4, 10.2), QPointF(20, 10.2))
    p.drawLine(QPointF(8.4, 3.6), QPointF(8.4, 7.4))
    p.drawLine(QPointF(15.6, 3.6), QPointF(15.6, 7.4))


def _ic_user(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawEllipse(QPointF(12, 8.4), 3.7, 3.7)
    _nofill(p)
    sh = QPainterPath()
    sh.moveTo(4.8, 20)
    sh.quadTo(4.8, 14, 12, 14)
    sh.quadTo(19.2, 14, 19.2, 20)
    p.drawPath(sh)


def _ic_clock(p, c, soft, lv):
    p.setPen(_stroke(c, 1.8))
    p.setBrush(soft)
    p.drawEllipse(QPointF(12, 12), 8.4, 8.4)
    _nofill(p)
    p.drawLine(QPointF(12, 7.2), QPointF(12, 12))
    p.drawLine(QPointF(12, 12), QPointF(15.4, 14))


_ICON_FNS = {
    "play": _ic_play, "pause": _ic_pause, "prev": _ic_prev, "next": _ic_next,
    "repeat": _ic_repeat, "repeat_one": _ic_repeat_one, "lyrics": _ic_lyrics,
    "vol_down": _ic_vol_down, "vol_up": _ic_vol_up, "mute": _ic_mute,
    "home": _ic_home, "music": _ic_music, "todo": _ic_todo, "note": _ic_note,
    "clip": _ic_clip, "apps": _ic_apps, "focus": _ic_focus, "pin": _ic_pin,
    "snip": _ic_snip, "more": _ic_more, "open": _ic_open, "add": _ic_add, "trash": _ic_trash,
    "sun": _ic_sun, "moon": _ic_moon, "cloud": _ic_cloud, "cloud_sun": _ic_cloud_sun,
    "rain": _ic_rain, "storm": _ic_storm, "fog": _ic_fog,
    "battery": _ic_battery, "bolt": _ic_bolt, "cpu": _ic_cpu, "calendar": _ic_calendar,
    "user": _ic_user, "clock": _ic_clock, "check": _ic_check,
}


def draw_icon(p, name, cx, cy, size, color, lv=None):
    fn = _ICON_FNS.get(name)
    if fn is None:
        return
    p.save()
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.translate(cx, cy)
    s = size / 24.0
    p.scale(s, s)
    p.translate(-12, -12)
    col = QColor(color)
    soft = QColor(col)
    soft.setAlpha(int(col.alpha() * 0.30))
    fn(p, col, soft, lv)
    p.restore()


class VecIcon(QWidget):
    """Ikon vektor kecil yang bisa ditaruh di layout (mis. indikator repeat di bar kecil)."""

    def __init__(self, name, size=14, parent=None):
        super().__init__(parent)
        self.name = name
        self.sz = size
        self.col = QColor(255, 255, 255, 200)
        self.setFixedSize(size, size)

    def set_icon(self, name):
        if name != self.name:
            self.name = name
            self.update()

    def set_color(self, c):
        self.col = QColor(c)
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        draw_icon(p, self.name, self.width() / 2, self.height() / 2, self.sz * 1.05, self.col)


class IconButton(QPushButton):
    """Tombol ikon bergaya modern: ikon vektor garis-membulat (bukan glyph font)."""

    def __init__(self, name, size=30, px=14, width=None, round_=True, parent=None):
        super().__init__(parent)
        self.px = px
        self.name = name
        self.rad = size // 2 if round_ else int(size * 0.36)
        self.fg_col = QColor(255, 255, 255, 184)
        self.setFixedSize(width or size, size)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.set_css()

    def set_icon(self, name):
        if name != self.name:
            self.name = name
            self.update()

    def set_css(self, bg="transparent", fg="rgba(255,255,255,0.72)",
                hover="rgba(255,255,255,0.12)", pressed="rgba(255,255,255,0.2)",
                border="transparent"):
        self.fg_col = parse_css_color(fg)
        self.setStyleSheet(
            f"QPushButton{{background:{bg};color:{fg};border:1px solid {border};border-radius:{self.rad}px;}}"
            f"QPushButton:hover{{background:{hover};}}"
            f"QPushButton:pressed{{background:{pressed};}}"
        )
        self.update()

    def paintEvent(self, e):
        super().paintEvent(e)
        p = QPainter(self)
        col = QColor(self.fg_col)
        lum = 0.299 * col.red() + 0.587 * col.green() + 0.114 * col.blue()
        if (self.underMouse() or self.isDown()) and lum > 110:
            col = QColor(255, 255, 255, 255)
        draw_icon(p, self.name, self.width() / 2.0, self.height() / 2.0, self.px * 1.42, col)


def pill_button(text, primary=False):
    b = QPushButton(text)
    b.setFont(make_font(11, QFont.Weight.DemiBold, 0.2))
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    b.setFixedHeight(28)
    if primary:
        b.setStyleSheet(
            "QPushButton{background:#fff;color:#000;border:none;border-radius:14px;padding:0 14px;}"
            "QPushButton:hover{background:rgba(255,255,255,0.88);}"
            "QPushButton:pressed{background:rgba(255,255,255,0.7);}")
    else:
        b.setStyleSheet(
            "QPushButton{background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.78);"
            "border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:0 12px;}"
            "QPushButton:hover{background:rgba(255,255,255,0.14);color:#fff;}"
            "QPushButton:pressed{background:rgba(255,255,255,0.22);}")
    return b


def seg_button(text):
    b = QPushButton(text)
    b.setFont(make_font(10, QFont.Weight.DemiBold, 0.2))
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    b.setFixedHeight(22)
    return b


def make_segment(radius):
    f = QFrame()
    f.setObjectName("seg")
    f.setStyleSheet(f"QFrame#seg{{background:rgba(255,255,255,0.07);border-radius:{radius}px;}}")
    lay = QHBoxLayout(f)
    lay.setContentsMargins(3, 2, 3, 2)
    lay.setSpacing(2)
    return f, lay


class ElideLabel(QLabel):
    def __init__(self, text="", px=12, weight=QFont.Weight.Medium,
                 color=QColor(255, 255, 255),
                 align=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                 tracking=0.0):
        super().__init__(text)
        self.setFont(make_font(px, weight, tracking))
        self._color = color
        self._align = align
        self.setMinimumWidth(0)
        self.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)

    def set_color(self, c):
        self._color = c
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setFont(self.font())
        p.setPen(self._color)
        txt = self.fontMetrics().elidedText(self.text(), Qt.TextElideMode.ElideRight, self.width())
        p.drawText(self.rect(), int(self._align), txt)


class ArtWidget(QWidget):
    def __init__(self, size, radius, parent=None):
        super().__init__(parent)
        self.setFixedSize(size, size)
        self.radius = radius
        self.active = False
        self.pix = None
        self.accent = "#0A84FF"

    def set_state(self, active):
        self.active = active
        self.update()

    def set_pixmap(self, pm):
        self.pix = pm
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = QRectF(self.rect())
        path = QPainterPath()
        path.addRoundedRect(r, self.radius, self.radius)

        if self.pix is not None and not self.pix.isNull():
            p.setClipPath(path)
            sc = self.pix.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                                 Qt.TransformationMode.SmoothTransformation)
            p.drawPixmap((self.width() - sc.width()) // 2, (self.height() - sc.height()) // 2, sc)
            return

        g = QLinearGradient(r.topLeft(), r.bottomRight())
        if self.active:
            g.setColorAt(0, QColor(self.accent))
            g.setColorAt(1, QColor(self.accent).darker(300))
        else:
            g.setColorAt(0, QColor(74, 74, 80))
            g.setColorAt(1, QColor(34, 34, 38))
        p.setBrush(QBrush(g))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawPath(path)
        p.setPen(QColor(255, 255, 255, 215))
        p.setFont(make_font(int(self.width() * 0.5), QFont.Weight.Bold))
        p.drawText(self.rect(), int(Qt.AlignmentFlag.AlignCenter), "♪")


class WaveBars(QWidget):
    def __init__(self, n=4, parent=None):
        super().__init__(parent)
        self.n = n
        self.phase = 0.0
        self.active = False
        self.color = QColor("#0A84FF")
        self.setFixedSize(n * 4 + 2, 14)

    def step(self):
        if self.active and self.isVisible():
            self.phase += 0.55
            self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(self.color)
        h = self.height()
        for i in range(self.n):
            v = 0.28 + 0.72 * abs(math.sin(self.phase + i * 1.35)) if self.active else 0.22
            bh = max(2.5, h * v)
            p.drawRoundedRect(QRectF(1 + i * 4, (h - bh) / 2, 2.5, bh), 1.2, 1.2)


class RingWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(126, 126)
        self.progress = 1.0
        self.text = "25:00"
        self.sub = "Siap"
        self.color = QColor("#0A84FF")

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(8, 8, self.width() - 16, self.height() - 16)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(255, 255, 255, 24), 6))
        p.drawEllipse(rect)
        pen = QPen(self.color, 6)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.drawArc(rect, 90 * 16, int(-360 * 16 * clamp01(self.progress)))
        p.setPen(QColor(255, 255, 255))
        p.setFont(make_font(26, QFont.Weight.Light, numeric=True))
        p.drawText(QRectF(0, self.height() / 2 - 24, self.width(), 32),
                   int(Qt.AlignmentFlag.AlignCenter), self.text)
        p.setPen(QColor(255, 255, 255, 140))
        p.setFont(make_font(9, QFont.Weight.Bold, 1.0))
        p.drawText(QRectF(0, self.height() / 2 + 10, self.width(), 16),
                   int(Qt.AlignmentFlag.AlignCenter), self.sub.upper())


class TodoDelegate(QStyledItemDelegate):
    def __init__(self, win):
        super().__init__(win)
        self.win = win

    def sizeHint(self, option, index):
        return QSize(option.rect.width(), 32)

    def paint(self, p, option, index):
        p.save()
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = option.rect
        done = bool(index.data(Qt.ItemDataRole.UserRole + 1))
        text = index.data(Qt.ItemDataRole.DisplayRole) or ""

        if option.state & QStyle.StateFlag.State_MouseOver:
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(255, 255, 255, 18))
            p.drawRoundedRect(QRectF(r).adjusted(2, 1, -2, -1), 9, 9)

        cx, cy = r.left() + 18, r.center().y()
        circle = QRectF(cx - 7.5, cy - 7.5, 15, 15)
        if done:
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(self.win.accent))
            p.drawEllipse(circle)
            pen = QPen(QColor(255, 255, 255), 1.8)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
            p.setPen(pen)
            p.setBrush(Qt.BrushStyle.NoBrush)
            chk = QPainterPath()
            chk.moveTo(cx - 3.3, cy + 0.3)
            chk.lineTo(cx - 0.9, cy + 2.8)
            chk.lineTo(cx + 3.5, cy - 2.6)
            p.drawPath(chk)
        else:
            p.setPen(QPen(QColor(255, 255, 255, 110), 1.5))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(circle)

        f = make_font(12, QFont.Weight.Medium)
        f.setStrikeOut(done)
        p.setFont(f)
        p.setPen(QColor(255, 255, 255, 95 if done else 235))
        tw = r.width() - 48
        el = QFontMetrics(f).elidedText(text, Qt.TextElideMode.ElideRight, tw)
        p.drawText(QRectF(r.left() + 34, r.top(), tw, r.height()),
                   int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), el)
        p.restore()


class ShortcutCard(QPushButton):
    """Kartu shortcut aplikasi/file/folder di dalam grid 4 kolom."""

    removed = pyqtSignal(str)

    def __init__(self, path_str, icon_provider, parent=None):
        super().__init__(parent)
        self.path_str = path_str
        self.setFixedHeight(58)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(6, 6, 6, 6)
        lay.setSpacing(3)

        p = Path(path_str)
        ico = icon_provider.icon(QFileInfo(path_str))
        lbl_ico = QLabel()
        lbl_ico.setPixmap(ico.pixmap(24, 24))
        lbl_ico.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl_ico.setStyleSheet("background:transparent;border:none;")

        name = p.stem if p.suffix.lower() in (".exe", ".lnk", ".url") else p.name
        lbl_txt = ElideLabel(name or path_str, 10, QFont.Weight.DemiBold,
                             QColor(255, 255, 255, 225), Qt.AlignmentFlag.AlignCenter)
        lbl_txt.setStyleSheet("background:transparent;border:none;")

        lay.addWidget(lbl_ico)
        lay.addWidget(lbl_txt)

        self.setToolTip(f"{path_str}\n(Klik kiri: Buka · Klik kanan: Hapus)")
        self.setStyleSheet(
            "QPushButton{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:12px;}"
            "QPushButton:hover{background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.22);}"
            "QPushButton:pressed{background:rgba(255,255,255,0.20);}"
        )

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.RightButton:
            self.removed.emit(self.path_str)
        else:
            super().mousePressEvent(e)


# ───────────────────────── Style Helper ─────────────────────────
def list_css():
    return (
        "QListWidget{background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.92);"
        "border:none;border-radius:13px;padding:4px;outline:none;}"
        "QListWidget::item{padding:5px 8px;border-radius:8px;}"
        "QListWidget::item:hover{background:rgba(255,255,255,0.09);}"
        "QListWidget::item:selected{background:transparent;color:white;}"
        "QScrollBar:vertical{background:transparent;width:5px;margin:4px 2px;}"
        "QScrollBar::handle:vertical{background:rgba(255,255,255,0.22);border-radius:2px;min-height:20px;}"
        "QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}"
    )


def input_css(accent):
    return (
        "QLineEdit{background:rgba(255,255,255,0.08);color:white;border:1px solid transparent;"
        f"border-radius:12px;padding:5px 12px;selection-background-color:{accent};}}"
        f"QLineEdit:focus{{border:1px solid {rgba(accent, 0.85)};background:rgba(255,255,255,0.1);}}"
    )


def notes_css(accent):
    return (
        "QTextEdit{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.92);border:none;"
        f"border-radius:13px;padding:8px;selection-background-color:{accent};}}"
    )


def label(text, px=10, weight=QFont.Weight.Bold, color=TXT2, tracking=0.9):
    l = QLabel(text)
    l.setFont(make_font(px, weight, tracking))
    l.setStyleSheet(f"color:{color};background:transparent;")
    return l


DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
DAYS_SHORT = ["SEN", "SEL", "RAB", "KAM", "JUM", "SAB", "MIN"]
MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
             "Agustus", "September", "Oktober", "November", "Desember"]

CUSTOM_DEFAULT = {"image": "", "c1": "#0B1020", "c2": "#241455", "c3": "#7C5CFF",
                  "anim": True, "blur": True}


def default_user_name():
    n = (os.environ.get("USERNAME") or os.environ.get("USER") or "Kamu").strip()
    return n.split()[0].capitalize() if n else "Kamu"


def blur_pixmap(pm, factor=7):
    w, h = pm.width(), pm.height()
    small = pm.scaled(max(8, w // factor), max(8, h // factor),
                      Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
    return small.scaled(w, h, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)


def palette_from_pixmap(pm):
    """Ambil 3 warna dari gambar: latar gelap, warna tengah, dan aksen yang cerah."""
    img = pm.scaled(24, 24, Qt.AspectRatioMode.IgnoreAspectRatio,
                    Qt.TransformationMode.SmoothTransformation).toImage()
    cols = [QColor(img.pixel(x, y)) for y in range(24) for x in range(24)]
    vivid = sorted(cols, key=lambda c: c.hsvSaturationF() * (0.4 + c.valueF()), reverse=True)[:70]
    r = sum(c.red() for c in vivid) // len(vivid)
    g = sum(c.green() for c in vivid) // len(vivid)
    b = sum(c.blue() for c in vivid) // len(vivid)
    acc = QColor(r, g, b)
    hh, ss, vv, _ = acc.getHsv()
    acc.setHsv(max(hh, 0), max(ss, 130), max(vv, 215))
    ar = sum(c.red() for c in cols) // len(cols)
    ag = sum(c.green() for c in cols) // len(cols)
    ab = sum(c.blue() for c in cols) // len(cols)
    avg = QColor(ar, ag, ab)
    c2 = avg.darker(170)
    c1 = avg.darker(380)
    return {"c1": c1.name(), "c2": c2.name(), "c3": acc.name()}


def weather_info(code, is_day=True):
    code = int(code)
    if code in (0, 1):
        return ("sun" if is_day else "moon"), "Cerah"
    if code == 2:
        return "cloud_sun", "Cerah berawan"
    if code == 3:
        return "cloud", "Berawan"
    if code in (45, 48):
        return "fog", "Berkabut"
    if 51 <= code <= 57:
        return "rain", "Gerimis"
    if 61 <= code <= 67:
        return "rain", "Hujan"
    if 71 <= code <= 77 or code in (85, 86):
        return "cloud", "Salju"
    if 80 <= code <= 82:
        return "rain", "Hujan deras"
    if code >= 95:
        return "storm", "Badai petir"
    return "cloud", "Berawan"


class WeatherFetcher(threading.Thread):
    """Cuaca dari Open-Meteo (gratis, tanpa API key). Kota diatur dari tab Home."""

    def __init__(self):
        super().__init__(daemon=True)
        self._city = ""
        self._data = None
        self._last = 0.0
        self._lock = threading.Lock()

    def set_city(self, city):
        with self._lock:
            self._city = (city or "").strip()
            self._data = None
            self._last = 0.0

    def city(self):
        with self._lock:
            return self._city

    def get(self):
        with self._lock:
            return None if self._data is None else dict(self._data)

    @staticmethod
    def _get_json(url):
        req = urllib.request.Request(url, headers={"User-Agent": "FlowIslandPro/2.2"})
        with urllib.request.urlopen(req, timeout=7) as resp:
            return json.loads(resp.read().decode("utf-8", errors="ignore"))

    def _fetch(self, city):
        g = self._get_json("https://geocoding-api.open-meteo.com/v1/search?" +
                           urllib.parse.urlencode({"name": city, "count": 1, "language": "id", "format": "json"}))
        res = (g.get("results") or [])
        if not res:
            return {"notfound": True}
        r0 = res[0]
        q = urllib.parse.urlencode({
            "latitude": r0["latitude"], "longitude": r0["longitude"],
            "current": "temperature_2m,weather_code,is_day", "timezone": "auto"})
        w = self._get_json("https://api.open-meteo.com/v1/forecast?" + q)
        cur = w.get("current") or {}
        return {"temp": int(round(cur.get("temperature_2m", 0))),
                "code": int(cur.get("weather_code", 3)),
                "is_day": bool(cur.get("is_day", 1)),
                "name": r0.get("name", city)}

    def run(self):
        while True:
            time.sleep(1.5)
            with self._lock:
                city, last, have = self._city, self._last, self._data is not None
            if not city:
                continue
            if have and time.time() - last < 900:
                continue
            if not have and last and time.time() - last < 60:
                continue
            try:
                data = self._fetch(city)
            except Exception:
                data = {"error": True}
            with self._lock:
                if self._city == city:
                    self._data = data
                    self._last = time.time()


class HomeView(QWidget):
    """Halaman Home: sapaan + nama, jam besar, tanggal, kalender mingguan, kartu status
    (baterai, tugas, sistem, cuaca) dan mini player."""

    nameClicked = pyqtSignal()
    weatherClicked = pyqtSignal()
    musicClicked = pyqtSignal()

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.setMouseTracking(True)
        self._name_rect = QRectF()
        self._wx_rect = QRectF()
        self._music_rect = QRectF()
        self._hover = None

    # ── interaksi ──
    def _hit(self, pos):
        if self._name_rect.contains(pos):
            return "name"
        if self._wx_rect.contains(pos):
            return "wx"
        if self._music_rect.contains(pos):
            return "music"
        return None

    def mouseMoveEvent(self, e):
        h = self._hit(e.position())
        if h != self._hover:
            self._hover = h
            self.setCursor(Qt.CursorShape.PointingHandCursor if h else Qt.CursorShape.ArrowCursor)
            self.update()

    def leaveEvent(self, e):
        self._hover = None
        self.update()

    def mousePressEvent(self, e):
        if e.button() != Qt.MouseButton.LeftButton:
            return
        h = self._hit(e.position())
        if h == "name":
            self.nameClicked.emit()
        elif h == "wx":
            self.weatherClicked.emit()
        elif h == "music":
            self.musicClicked.emit()

    # ── gambar ──
    def _tile(self, p, rect, icon, label_, value, sub, color, lv=None, bar=None):
        p.setPen(QPen(QColor(255, 255, 255, 18), 1))
        p.setBrush(QColor(255, 255, 255, 15))
        p.drawRoundedRect(rect.adjusted(0.5, 0.5, -0.5, -0.5), 14, 14)
        draw_icon(p, icon, rect.left() + 17, rect.top() + 15, 16, color, lv)
        p.setFont(make_font(9, QFont.Weight.Bold, 1.1))
        p.setPen(QColor(255, 255, 255, 125))
        p.drawText(QRectF(rect.left() + 32, rect.top() + 7, rect.width() - 38, 16),
                   int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), label_)
        p.setFont(make_font(20, QFont.Weight.DemiBold, numeric=True))
        p.setPen(QColor(255, 255, 255, 245))
        p.drawText(QRectF(rect.left() + 12, rect.top() + 21, rect.width() - 16, 26),
                   int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), value)
        f = make_font(10, QFont.Weight.Medium)
        p.setFont(f)
        p.setPen(QColor(255, 255, 255, 135))
        el = QFontMetrics(f).elidedText(sub, Qt.TextElideMode.ElideRight, int(rect.width() - 20))
        p.drawText(QRectF(rect.left() + 12, rect.bottom() - 19, rect.width() - 16, 14),
                   int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), el)
        if bar is not None:
            by = rect.bottom() - 5.5
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(255, 255, 255, 26))
            p.drawRoundedRect(QRectF(rect.left() + 12, by, rect.width() - 24, 3), 1.5, 1.5)
            fill = QColor(color)
            p.setBrush(fill)
            p.drawRoundedRect(QRectF(rect.left() + 12, by, (rect.width() - 24) * clamp01(bar), 3), 1.5, 1.5)

    def paintEvent(self, e):
        win = self.win
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        W, H = self.width(), self.height()
        now = datetime.now()
        acc = QColor(win.accent)
        LW = int(W * 0.47)
        L = int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft)
        C = int(Qt.AlignmentFlag.AlignCenter)

        # sapaan sesuai jam
        hr = now.hour
        if hr < 4 or hr >= 19:
            greet, gi = "SELAMAT MALAM", "moon"
        elif hr < 11:
            greet, gi = "SELAMAT PAGI", "sun"
        elif hr < 15:
            greet, gi = "SELAMAT SIANG", "sun"
        else:
            greet, gi = "SELAMAT SORE", "cloud_sun"
        draw_icon(p, gi, 8, 9, 16, acc)
        p.setFont(make_font(10, QFont.Weight.Bold, 1.5))
        p.setPen(acc)
        p.drawText(QRectF(22, 0, LW, 18), L, greet)

        # nama pengguna (klik untuk mengubah)
        name = win.user_name or "Kamu"
        nf = make_font(26, QFont.Weight.Bold)
        nfm = QFontMetrics(nf)
        nm = nfm.elidedText(name, Qt.TextElideMode.ElideRight, LW - 34)
        p.setFont(nf)
        p.setPen(QColor(255, 255, 255))
        p.drawText(QRectF(0, 18, LW, 34), L, nm)
        nw = nfm.horizontalAdvance(nm)
        self._name_rect = QRectF(0, 18, nw + 28, 34)
        if self._hover == "name":
            draw_icon(p, "note", nw + 16, 35, 14, QColor(255, 255, 255, 170))

        # jam besar + detik
        tf = make_font(52, QFont.Weight.Light, numeric=True)
        tm = now.strftime("%H:%M")
        p.setFont(tf)
        p.setPen(QColor(255, 255, 255))
        p.drawText(QRectF(0, 50, LW, 62), L, tm)
        tw = QFontMetrics(tf).horizontalAdvance(tm)
        p.setFont(make_font(15, QFont.Weight.Medium, numeric=True))
        p.setPen(acc)
        p.drawText(QRectF(tw + 4, 58, 40, 22), int(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft),
                   now.strftime("%S"))

        # tanggal
        p.setFont(make_font(12, QFont.Weight.Medium))
        p.setPen(QColor(255, 255, 255, 185))
        p.drawText(QRectF(0, 113, LW, 20), L,
                   f"{DAYS_ID[now.weekday()]}, {now.day} {MONTHS_ID[now.month - 1]} {now.year}")
        iso = now.isocalendar()
        p.setFont(make_font(10, QFont.Weight.Medium, 0.3))
        p.setPen(QColor(255, 255, 255, 100))
        p.drawText(QRectF(0, 133, LW, 16), L,
                   f"Minggu ke-{iso[1]}  ·  hari ke-{now.timetuple().tm_yday}")

        # mini player
        pr = QRectF(0, H - 30, LW - 6, 28)
        self._music_rect = pr
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(255, 255, 255, 26 if self._hover == "music" else 14))
        p.drawRoundedRect(pr, 14, 14)
        draw_icon(p, "music", 16, H - 16, 14, acc if win.has_track else QColor(255, 255, 255, 120))
        if win.has_track:
            txt = win.current_title + (f"  ·  {win.current_artist}" if win.current_artist else "")
            tcol = QColor(255, 255, 255, 225)
        else:
            txt, tcol = "Belum ada musik · buka tab Musik", QColor(255, 255, 255, 120)
        mf = make_font(11, QFont.Weight.Medium)
        p.setFont(mf)
        p.setPen(tcol)
        p.drawText(QRectF(30, H - 30, pr.width() - 38, 28), L,
                   QFontMetrics(mf).elidedText(txt, Qt.TextElideMode.ElideRight, int(pr.width() - 40)))

        # kalender mingguan
        x0 = LW + 10
        RW = W - x0
        monday = now.date() - timedelta(days=now.weekday())
        cw = RW / 7.0
        for i in range(7):
            d = monday + timedelta(days=i)
            cx = x0 + cw * i + cw / 2.0
            today = (d == now.date())
            if today:
                g = QLinearGradient(0, 0, 0, 44)
                g.setColorAt(0, acc.lighter(115))
                g.setColorAt(1, acc.darker(125))
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QBrush(g))
                p.drawRoundedRect(QRectF(cx - cw / 2 + 1, 0, cw - 2, 44), 13, 13)
            p.setFont(make_font(9, QFont.Weight.Bold, 0.8))
            p.setPen(QColor(255, 255, 255, 235 if today else 105))
            p.drawText(QRectF(cx - cw / 2, 5, cw, 12), C, DAYS_SHORT[i])
            p.setFont(make_font(14, QFont.Weight.Bold if today else QFont.Weight.Medium, numeric=True))
            p.setPen(QColor(255, 255, 255, 255 if today else (170 if i < 5 else 120)))
            p.drawText(QRectF(cx - cw / 2, 19, cw, 20), C, str(d.day))

        # kartu status 2×2
        top = 52
        th = (H - top - 8) / 2.0
        tw2 = (RW - 8) / 2.0
        r1 = QRectF(x0, top, tw2, th)
        r2 = QRectF(x0 + tw2 + 8, top, tw2, th)
        r3 = QRectF(x0, top + th + 8, tw2, th)
        r4 = QRectF(x0 + tw2 + 8, top + th + 8, tw2, th)

        batt = int(win.batt_pct)
        bcol = QColor("#30D158") if win.charging else (QColor("#FF453A") if batt < 20 else acc)
        self._tile(p, r1, "battery", "BATERAI", f"{batt}%",
                   "Sedang mengisi" if win.charging else ("Hampir habis" if batt < 20 else "Daya normal"),
                   bcol, lv=batt / 100.0)

        todos = win.data.get("todos", [])
        done = sum(1 for t in todos if t.get("done"))
        self._tile(p, r2, "todo", "TUGAS", f"{done}/{len(todos)}", "tugas selesai", acc,
                   bar=(done / len(todos)) if todos else 0.0)

        self._tile(p, r3, "cpu", "SISTEM", f"{win.cpu_pct}%", f"RAM {win.ram_pct}%", acc,
                   bar=win.cpu_pct / 100.0)

        self._wx_rect = r4
        city = win.weather.city()
        wx = win.weather.get()
        if not city:
            self._tile(p, r4, "cloud", "CUACA", "—", "Atur kota  ›", acc)
        elif wx is None:
            self._tile(p, r4, "cloud", city.upper()[:14], "…", "Memuat cuaca", acc)
        elif wx.get("notfound"):
            self._tile(p, r4, "cloud", "CUACA", "?", "Kota tidak ketemu", acc)
        elif wx.get("error"):
            self._tile(p, r4, "cloud", city.upper()[:14], "—", "Gagal memuat", acc)
        else:
            icon, cond = weather_info(wx["code"], wx["is_day"])
            self._tile(p, r4, icon, str(wx["name"]).upper()[:14], f"{wx['temp']}°", cond, acc)
        if self._hover == "wx":
            p.setPen(QPen(QColor(acc.red(), acc.green(), acc.blue(), 150), 1.4))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawRoundedRect(r4.adjusted(0.5, 0.5, -0.5, -0.5), 14, 14)


# ───────────────────────── Aplikasi Utama ─────────────────────────
class FlowIslandPro(QWidget):
    COLLAPSED_H = 28
    CHROME_H = 22
    CHROME_W = 86
    IDLE_W, ACTIVE_W, TOAST_W = 108, 192, 232
    TIMER_EXTRA = 38
    EXP_W, EXP_H = 560, 244
    LYR_W = 290
    TAB_HOME, TAB_MUSIC, TAB_TODO, TAB_NOTES, TAB_CLIP, TAB_APPS, TAB_FOCUS = range(7)
    COL_RB, EXP_RB = 12, 30

    def __init__(self):
        super().__init__()
        self.setAcceptDrops(True)

        self.is_expanded = False
        self.is_pinned = False
        self.menu_open = False
        self.chrome_active = False
        self.lyrics_open = False

        self.music_source = "Semua"
        self.playing_source = "Musik"
        self.has_track = False
        self.is_playing = False
        self.track_visible = False
        self.last_play_time = 0.0
        self.autoplay_until = 0.0
        self.current_title = ""
        self.current_artist = ""
        self.art_key = None

        self.song_pos = 0.0
        self.song_dur = 0.0
        self.song_sampled_at = time.monotonic()
        self.has_timeline = False
        self.local_pos = 0.0
        self._clock_t = time.monotonic()
        self.seek_hold_until = 0.0
        self.lyrics_offset = 0.0

        self.repeat_mode = 0
        self.repeat_ok = False
        self.soft_repeat = False
        self.last_track_key = None
        self.was_playing = False
        self.user_skip_until = 0.0

        self.toast_message = ""
        self.toast_ticks = 0
        self.last_charging_state = None
        self.batt_pct, self.charging = 100, False
        self.sys_text = ""

        self.timer_running = False
        self.time_total = 25 * 60
        self.time_left = self.time_total
        self.tick_count = 0

        self.clipboard_history = []
        self.dropped_files = []
        self.shortcuts = []
        self.icon_provider = QFileIconProvider()

        self.enter_since = None
        self.leave_since = None
        self.hover_block_until = 0.0

        screen = QApplication.primaryScreen().geometry()
        self.screen_x, self.screen_w = screen.x(), screen.width()
        self.cur = (self.IDLE_W, self.COLLAPSED_H, self.COL_RB)
        self.anim_mode = "resize"
        self.anim_from = self.anim_to = self.cur

        self.app_icon = create_app_icon()
        self.setWindowIcon(self.app_icon)

        self.bridge = MediaBridge()
        self.lyrics_fetcher = LyricsFetcher()
        self.weather = WeatherFetcher()
        self.cpu_pct = 0
        self.ram_pct = 0
        self.user_name = ""
        self.custom = dict(CUSTOM_DEFAULT)
        self.custom_pix = None
        self.bg_phase = 0.0
        self.bg_timer = QTimer(self)
        self.bg_timer.timeout.connect(self._bg_tick)

        self.init_window()
        self.load_data()
        self.build_ui()
        self.init_tray_icon()
        self.setup_hooks_and_timers()

    def init_window(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool |
            Qt.WindowType.NoDropShadowWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.anim = QVariantAnimation(self)
        self.anim.valueChanged.connect(self.on_anim_value)
        self.anim.finished.connect(self.on_anim_finished)

    def apply_shape(self, w, h, rb):
        self.cur = (w, h, rb)
        x = self.screen_x + (self.screen_w - int(w)) // 2 - M
        self.setGeometry(x, 0, int(w) + 2 * M, int(h) + M)
        self.compact_widget.setGeometry(M + EAR + 6, 0, max(10, int(w) - 2 * EAR - 12), int(h))
        if self.is_expanded or self.expanded_widget.isVisible():
            ew = max(self.EXP_W, int(w)) - 2 * EAR - 32
            self.expanded_widget.setGeometry(M + EAR + 16, 6, ew, self.EXP_H - 20)
        self.update()

    def animate_to(self, w, h, rb, mode, duration, curve):
        self.anim.stop()
        self.clearMask()
        self.anim_mode = mode
        self.anim_from = self.cur
        self.anim_to = (w, h, rb)
        self.anim.setDuration(duration)
        self.anim.setEasingCurve(curve)
        self.anim.setStartValue(0.0)
        self.anim.setEndValue(1.0)
        self.anim.start()

    def on_anim_value(self, t):
        t = float(t)
        a, b = self.anim_from, self.anim_to
        w = a[0] + (b[0] - a[0]) * t
        h = max(self.CHROME_H, a[1] + (b[1] - a[1]) * t)
        rb = a[2] + (b[2] - a[2]) * t
        if self.anim_mode == "expand":
            self.fx_exp.setOpacity(clamp01((t - 0.4) / 0.5))
            self.fx_comp.setOpacity(clamp01(1 - t / 0.25))
            if t > 0.3 and not self.expanded_widget.isVisible():
                self.expanded_widget.show()
        elif self.anim_mode == "collapse":
            self.fx_exp.setOpacity(clamp01(1 - t / 0.3))
            self.fx_comp.setOpacity(clamp01((t - 0.55) / 0.4))
        self.apply_shape(w, h, rb)

    def on_anim_finished(self):
        w, h, rb = self.anim_to
        self.apply_shape(w, h, rb)
        if self.anim_mode == "expand":
            self.compact_widget.hide()
            self.fx_exp.setOpacity(1.0)
        elif self.anim_mode == "collapse":
            self.expanded_widget.hide()
            self.compact_widget.show()
            self.fx_comp.setOpacity(1.0)
        if not self.is_expanded:
            self.setMask(QRegion(QRect(M, 0, int(w), int(h))))

    def expand_island(self):
        if self.is_expanded:
            return
        self.is_expanded = True
        self.fx_exp.setOpacity(0.0)
        self.raise_()
        curve = QEasingCurve(QEasingCurve.Type.OutBack)
        curve.setOvershoot(0.75)
        self.animate_to(self.exp_target_w(), self.EXP_H, self.EXP_RB, "expand", 430, curve)

    def collapse_island(self):
        if not self.is_expanded:
            return
        self.is_expanded = False
        self.compact_widget.show()
        self.fx_comp.setOpacity(0.0)
        w, h, rb = self.refresh_compact(animate=False)
        self.animate_to(w, h, rb, "collapse", 320, QEasingCurve(QEasingCurve.Type.OutCubic))

    def shape_path(self, w, h, rb):
        ear = min(EAR, h / 2)
        rb = max(2.0, min(rb, h / 2 - 1, (w - 2 * ear) / 2))
        x0 = M
        path = QPainterPath()
        path.moveTo(x0, 0)
        path.arcTo(QRectF(x0 - ear, 0, 2 * ear, 2 * ear), 90, -90)
        path.lineTo(x0 + ear, h - rb)
        path.arcTo(QRectF(x0 + ear, h - 2 * rb, 2 * rb, 2 * rb), 180, 90)
        path.lineTo(x0 + w - ear - rb, h)
        path.arcTo(QRectF(x0 + w - ear - 2 * rb, h - 2 * rb, 2 * rb, 2 * rb), 270, 90)
        path.lineTo(x0 + w - ear, ear)
        path.arcTo(QRectF(x0 + w - ear, 0, 2 * ear, 2 * ear), 180, -90)
        path.closeSubpath()
        return path

    def paintEvent(self, event):
        w, h, rb = self.cur
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        path = self.shape_path(w, h, rb)

        s = clamp01((h - self.COLLAPSED_H) / 110.0)
        if s > 0.02:
            sp = QPainterPath(path)
            sp.translate(0, 5)
            for i in range(1, 7):
                pen = QPen(QColor(0, 0, 0, int(9 * s)), i * 3)
                pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
                p.setPen(pen)
                p.setBrush(Qt.BrushStyle.NoBrush)
                p.drawPath(sp)

        grad = QLinearGradient(M, 0, M + w, h)
        grad.setColorAt(0.0, QColor(self.theme["bg1"]))
        grad.setColorAt(1.0, QColor(self.theme["bg2"]))
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(grad))
        p.drawPath(path)

        if self.theme_name == "Kustom":
            self.draw_custom_bg(p, w, h, path)

        if self.ornaments:
            self.draw_ornaments(p, w, h, path, s)

        klasik = self.theme_name == "Klasik"
        base = QColor(255, 255, 255) if klasik else QColor(self.accent)
        c0, c1 = QColor(base), QColor(base)
        c0.setAlpha(0)
        c1.setAlpha(55 if klasik else 120)
        rim = QLinearGradient(0, 0, 0, h)
        rim.setColorAt(0.35, c0)
        rim.setColorAt(1.0, c1)
        pen = QPen(QBrush(rim), 1.1)
        pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(path)

    def draw_ornaments(self, p, w, h, path, s):
        p.save()
        p.setClipPath(path)
        p.setPen(Qt.PenStyle.NoPen)
        x0 = M
        a = QColor(self.accent)

        def ac(alpha):
            c = QColor(a)
            c.setAlpha(int(max(0, min(255, alpha))))
            return c

        if self.theme_name != "Klasik":
            g = QRadialGradient(x0 + w * 0.9, h * 0.1, max(w, h) * 0.55)
            g.setColorAt(0.0, ac(64 + 40 * s))
            g.setColorAt(1.0, ac(0))
            p.setBrush(QBrush(g))
            p.drawRect(QRectF(x0, 0, w, h))

        if s > 0.03:
            fn = getattr(self, "orn_" + self.theme.get("orn", "none"), None)
            if fn:
                fn(p, w, h, s, ac)
        p.restore()

    def orn_dots(self, p, w, h, s, ac):
        step = 16
        cols = int(w * 0.5 // step)
        for ix in range(cols):
            fade = 1.0 - ix / max(1, cols)
            pen = QPen(QColor(255, 255, 255, int(46 * s * fade)), 2.0)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            p.setPen(pen)
            x = M + w - 16 - ix * step
            for iy in range(int((h - 10) // step)):
                p.drawPoint(QPointF(x, 12 + iy * step))

    def orn_stars(self, p, w, h, s, ac):
        p.setPen(Qt.PenStyle.NoPen)
        for rx, ry, sz in STARS:
            p.setBrush(QColor(255, 255, 255, int(110 * s * (0.45 + sz / 4))))
            p.drawEllipse(QPointF(M + rx * w, ry * h), sz * 0.6, sz * 0.6)
        p.setBrush(QColor(255, 255, 255, int(160 * s)))
        for rx, ry, r in SPARKLES:
            p.drawPath(sparkle_path(M + rx * w, ry * h, r))

    def orn_orbs(self, p, w, h, s, ac):
        base = QColor(self.accent)
        c2 = QColor.fromHsv((base.hue() + 70) % 360, base.saturation(), base.value())
        c2.setAlpha(int(54 * s))
        g = QRadialGradient(M + w * 0.1, h, max(w, h) * 0.5)
        g.setColorAt(0.0, c2)
        c2z = QColor(c2)
        c2z.setAlpha(0)
        g.setColorAt(1.0, c2z)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(g))
        p.drawRect(QRectF(M, 0, w, h))
        p.setBrush(ac(34 * s))
        for rx, ry, r in [(0.88, 0.30, 22), (0.70, 0.82, 16), (0.95, 0.80, 10), (0.55, 0.20, 8)]:
            p.drawEllipse(QPointF(M + rx * w, ry * h), r, r)

    def orn_rings(self, p, w, h, s, ac):
        cx, cy = M + w * 0.93, h * 0.10
        p.setBrush(Qt.BrushStyle.NoBrush)
        for i, r in enumerate((26, 52, 80, 112, 148)):
            p.setPen(QPen(ac(48 * s * (1 - i * 0.14)), 1.2))
            p.drawEllipse(QPointF(cx, cy), r, r)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(ac(130 * s))
        p.drawEllipse(QPointF(cx, cy), 6, 6)

    def orn_petals(self, p, w, h, s, ac):
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(ac(54 * s))
        for rx, ry, size, ang in [(0.90, 0.16, 16, -30), (0.82, 0.34, 12, 15), (0.95, 0.62, 14, 50),
                                  (0.72, 0.86, 12, -20), (0.08, 0.90, 11, 35)]:
            p.save()
            p.translate(M + rx * w, ry * h)
            p.rotate(ang)
            p.drawEllipse(QRectF(-size / 2, -size / 4, size, size / 2))
            p.restore()

    def orn_lines(self, p, w, h, s, ac):
        p.setPen(QPen(ac(24 * s), 1.0))
        for x in range(int(-h), int(w), 18):
            p.drawLine(QPointF(M + x, h), QPointF(M + x + h * 0.7, 0))

    def orn_shapes(self, p, w, h, s, ac):
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(ac(120 * s), 1.6))
        p.drawEllipse(QPointF(M + w * 0.93, h * 0.20), 11, 11)
        px, py = M + w * 0.80, h * 0.11
        p.drawLine(QPointF(px - 7, py), QPointF(px + 7, py))
        p.drawLine(QPointF(px, py - 7), QPointF(px, py + 7))

    def load_data(self):
        self.data = {
            "todos": [
                {"text": "Cicil penulisan & revisi bab skripsi", "done": False},
                {"text": "Rapikan kutipan jurnal & daftar pustaka", "done": False},
            ],
            "sticky": (
                "Catatan Bimbingan & Skripsi:\n"
                "- Cek kembali bab metodologi & pengujian\n"
                "- Simpan kutipan penting di tab Clipboard"
            ),
            "source": "Semua",
            "theme": "Klasik",
            "ornaments": True,
            "dropped_files": [],
            "shortcuts": [],
        }
        if DATA_FILE.exists():
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    self.data.update(json.load(f))
            except Exception:
                pass
        src = self.data.get("source", "Semua")
        self.music_source = src if src in ("Semua", "Spotify", "Browser") else "Semua"
        self.dropped_files = self.data.get("dropped_files", [])
        self.shortcuts = self.data.get("shortcuts", [])
        cust = self.data.get("custom")
        self.custom = dict(CUSTOM_DEFAULT)
        if isinstance(cust, dict):
            self.custom.update(cust)
        self.rebuild_custom()
        self.user_name = str(self.data.get("user_name") or "").strip() or default_user_name()
        self.weather.set_city(str(self.data.get("weather_city") or ""))
        name = self.data.get("theme", "Klasik")
        self.theme_name = name if name in THEMES else "Klasik"
        self.theme = THEMES[self.theme_name]
        self.accent = self.theme["accent"]
        self.ornaments = bool(self.data.get("ornaments", True))
        try:
            self.lyrics_offset = float(self.data.get("lyrics_offset", 0.0))
        except Exception:
            self.lyrics_offset = 0.0
        self.bridge.prefer = self.music_source

    def save_data(self):
        self.data["source"] = self.music_source
        self.data["theme"] = self.theme_name
        self.data["ornaments"] = self.ornaments
        self.data["lyrics_offset"] = self.lyrics_offset
        self.data["sticky"] = self.sticky_edit.toPlainText()
        self.data["dropped_files"] = self.dropped_files
        self.data["shortcuts"] = self.shortcuts
        self.data["custom"] = self.custom
        self.data["user_name"] = self.user_name
        try:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def apply_theme(self, name, save=True):
        if name not in THEMES:
            return
        self.theme_name = name
        self.theme = THEMES[name]
        self.accent = a = self.theme["accent"]
        a2 = QColor(a).darker(165).name()

        self.ring.color = QColor(a)
        self.ring.update()
        self.bars.color = QColor(a)
        self.eyes.accent = QColor(a)
        self.seek_bar.accent = QColor(a)
        self.seek_bar.update()
        self.lyrics_panel.set_accent(QColor(a))
        self.art_big.accent = a
        self.art_small.accent = a
        self.art_big.update()
        self.art_small.update()
        self.progress_bar.setStyleSheet(
            "QProgressBar{background:rgba(255,255,255,0.1);border:none;border-radius:2px;}"
            f"QProgressBar::chunk{{background:{a};border-radius:2px;}}")
        self.lbl_comp_timer.setStyleSheet(
            f"color:{a};background:{rgba(a, 0.2)};border-radius:8px;padding:0 6px;")
        self.todo_input.setStyleSheet(input_css(a))
        self.sticky_edit.setStyleSheet(notes_css(a))
        self.btn_pomo.setStyleSheet(
            f"QPushButton{{background:qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 {a},stop:1 {a2});"
            "color:#fff;border:none;border-radius:15px;padding:0 16px;}"
            f"QPushButton:hover{{background:{a};}}QPushButton:pressed{{background:{a2};}}")
        self.switch_tab(self.stack.currentIndex())
        self.refresh_source_buttons()
        self.refresh_music_ui()
        for n, act in self.theme_actions.items():
            act.setIcon(theme_icon(THEMES[n], n == name))
        self.update_bg_timer()
        self.update()
        if save:
            self.save_data()

    def set_ui_scale(self, name):
        val = UI_SCALES.get(name, DEFAULT_SCALE)
        self.data["ui_scale"] = val
        for n, act in self.scale_actions.items():
            act.setChecked(n == name)
        self.save_data()
        self.show_toast("Ukuran baru: buka ulang app")

    def toggle_ornaments(self, checked):
        self.ornaments = bool(checked)
        self.update()
        self.save_data()

    def init_tray_icon(self):
        self.tray = QSystemTrayIcon(self.app_icon, self)
        self.tray.setToolTip("FlowIsland Pro")
        menu = QMenu()
        menu.setStyleSheet(self.menu_css())
        a1 = QAction("Tampilkan / Sembunyikan", self)
        a1.triggered.connect(self.toggle_visibility)
        a2 = QAction("Toggle Auto-Startup Windows", self)
        a2.triggered.connect(self.toggle_startup)
        a3 = QAction("Keluar", self)
        a3.triggered.connect(QApplication.instance().quit)
        menu.addAction(a1)
        menu.addAction(a2)
        menu.addSeparator()
        menu.addAction(a3)
        self.tray.setContextMenu(menu)
        self.tray_menu = menu
        self.tray.activated.connect(self.on_tray_activated)
        self.tray.show()

    def menu_css(self):
        return (
            "QMenu{background:#0E0E10;color:#F5F5F7;border:1px solid rgba(255,255,255,0.1);padding:6px;}"
            "QMenu::item{padding:7px 20px 7px 12px;border-radius:7px;margin:1px 0;}"
            "QMenu::item:selected{background:rgba(255,255,255,0.12);}"
            "QMenu::icon{padding-left:6px;}"
            "QMenu::separator{height:1px;background:rgba(255,255,255,0.1);margin:5px 8px;}"
        )

    def on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.toggle_visibility()

    def toggle_visibility(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()
            self.raise_()

    def show_toast(self, text):
        self.toast_message = text
        self.toast_ticks = 4
        self.refresh_compact()
        self.refresh_status()

    def build_ui(self):
        self.build_compact()
        self.build_expanded()
        self.apply_shape(*self.cur)
        self.setMask(QRegion(QRect(M, 0, self.IDLE_W, self.COLLAPSED_H)))
        self.apply_theme(self.theme_name, save=False)
        self.refresh_compact(animate=False)

    def build_compact(self):
        self.compact_widget = QWidget(self)
        cl = QHBoxLayout(self.compact_widget)
        cl.setContentsMargins(0, 0, 0, 0)
        cl.setSpacing(5)
        self.compact_layout = cl

        self.eyes = BlinkingEyesWidget()
        self.eyes.hide()

        self.art_small = ArtWidget(18, 5)
        self.lbl_comp_title = ElideLabel("", 11, QFont.Weight.DemiBold, tracking=0.1)
        self.lbl_comp_timer = QLabel("25:00")
        self.lbl_comp_timer.setFont(make_font(10, QFont.Weight.DemiBold, numeric=True))
        self.lbl_comp_timer.setFixedHeight(16)
        self.lbl_clock = QLabel(datetime.now().strftime("%H:%M"))
        self.lbl_clock.setFont(make_font(11, QFont.Weight.DemiBold, 0.3, numeric=True))
        self.lbl_clock.setMinimumWidth(34)
        self.lbl_clock.setStyleSheet("color:rgba(255,255,255,0.92);background:transparent;")

        self.lbl_rep = VecIcon("repeat", 14)

        self.bars = WaveBars(4)

        cl.addWidget(self.eyes, 1, Qt.AlignmentFlag.AlignCenter)
        cl.addWidget(self.art_small)
        cl.addWidget(self.lbl_comp_title, 1)
        cl.addWidget(self.lbl_comp_timer)
        cl.addWidget(self.lbl_clock)
        cl.addWidget(self.lbl_rep)
        cl.addWidget(self.bars)

        self.fx_comp = QGraphicsOpacityEffect(self.compact_widget)
        self.fx_comp.setOpacity(1.0)
        self.compact_widget.setGraphicsEffect(self.fx_comp)

    def build_expanded(self):
        self.expanded_widget = QWidget(self)
        self.expanded_widget.setGeometry(
            M + EAR + 16, 6, self.EXP_W - 2 * EAR - 32, self.EXP_H - 6 - 14)
        self.expanded_widget.hide()
        self.fx_exp = QGraphicsOpacityEffect(self.expanded_widget)
        self.fx_exp.setOpacity(0.0)
        self.expanded_widget.setGraphicsEffect(self.fx_exp)

        root = QVBoxLayout(self.expanded_widget)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(8)

        header = QHBoxLayout()
        header.setSpacing(2)

        seg, sl = make_segment(16)
        self.tab_hl = QFrame(seg)
        self.tab_hl.setGeometry(3, 2, 34, 26)
        self.tab_hl.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.tab_hl_anim = QPropertyAnimation(self.tab_hl, b"geometry", self)
        self.tab_hl_anim.setDuration(320)
        self.tab_hl_anim.setEasingCurve(QEasingCurve.Type.OutBack)
        self.tab_buttons = []
        for i, (name, tip) in enumerate([
            ("home", "Home"),
            ("music", "Musik & Lirik"),
            ("todo", "To-Do Skripsi"),
            ("note", "Catatan"),
            ("clip", "Clipboard & Rak File"),
            ("apps", "Shortcut App & Folder (4 Kolom)"),
            ("focus", "Fokus & Tools"),
        ]):
            b = IconButton(name, 26, 13, width=34, round_=True)
            b.setToolTip(tip)
            b.clicked.connect(lambda _, idx=i: self.switch_tab(idx))
            sl.addWidget(b)
            self.tab_buttons.append(b)
        self.tab_hl.lower()
        header.addWidget(seg)

        header.addSpacing(10)
        self.lbl_status = ElideLabel("", 10, QFont.Weight.Medium,
                                     QColor(255, 255, 255, 140), tracking=0.2)
        self.lbl_status.setFixedHeight(28)
        header.addWidget(self.lbl_status, 1)

        self.lbl_batt = QLabel("100%")
        self.lbl_batt.setFont(make_font(10, QFont.Weight.DemiBold, 0.3, numeric=True))
        self.lbl_batt.setStyleSheet("color:rgba(255,255,255,0.85);background:transparent;")
        header.addWidget(self.lbl_batt)
        header.addSpacing(4)

        self.btn_pin = IconButton("pin", 28, 12)
        self.btn_pin.setToolTip("Pin (tetap terbuka)")
        self.btn_pin.clicked.connect(self.toggle_pin)
        btn_snip = IconButton("snip", 28, 12)
        btn_snip.setToolTip("Tangkap layar")
        btn_snip.clicked.connect(self.trigger_screenshot)
        self.btn_more = IconButton("more", 28, 14)
        self.btn_more.setToolTip("Tema & pengaturan")
        self.btn_more.clicked.connect(self.show_more_menu)
        for b in (self.btn_pin, btn_snip, self.btn_more):
            header.addWidget(b)
        root.addLayout(header)

        self.more_menu = QMenu(self)
        self.more_menu.setStyleSheet(self.menu_css())

        self.theme_menu = self.more_menu.addMenu("Tema warna")
        self.theme_menu.setStyleSheet(self.menu_css())
        self.theme_actions = {}
        for name, th in THEMES.items():
            act = QAction(theme_icon(th, name == self.theme_name), name, self)
            act.triggered.connect(lambda _, n=name: self.apply_theme(n))
            self.theme_menu.addAction(act)
            self.theme_actions[name] = act

        self.act_orn = QAction("Ornamen & glow", self)
        self.act_orn.setCheckable(True)
        self.act_orn.setChecked(self.ornaments)
        self.act_orn.toggled.connect(self.toggle_ornaments)
        self.more_menu.addAction(self.act_orn)

        self.custom_menu = self.more_menu.addMenu("Latar kustom (gambar / gradien)")
        self.custom_menu.setStyleSheet(self.menu_css())
        a_img = self.custom_menu.addAction("Pilih gambar…")
        a_img.triggered.connect(self.choose_custom_image)
        a_col = self.custom_menu.addAction("Atur warna gradien…")
        a_col.triggered.connect(self.choose_custom_colors)
        self.act_anim = QAction("Gradien dinamis (animasi)", self)
        self.act_anim.setCheckable(True)
        self.act_anim.setChecked(bool(self.custom.get("anim", True)))
        self.act_anim.toggled.connect(lambda v: self.set_custom_flag("anim", v))
        self.custom_menu.addAction(self.act_anim)
        self.act_blur = QAction("Blur gambar (teks lebih terbaca)", self)
        self.act_blur.setCheckable(True)
        self.act_blur.setChecked(bool(self.custom.get("blur", True)))
        self.act_blur.toggled.connect(lambda v: self.set_custom_flag("blur", v))
        self.custom_menu.addAction(self.act_blur)
        self.custom_menu.addSeparator()
        a_clr = self.custom_menu.addAction("Hapus gambar")
        a_clr.triggered.connect(self.clear_custom_image)

        self.font_menu = self.more_menu.addMenu("Gaya font")
        self.font_menu.setStyleSheet(self.menu_css())
        self.font_actions = {}
        for fname in FONT_STYLES:
            fa = QAction(fname, self)
            fa.setCheckable(True)
            fa.setChecked(fname == FONT_STYLE)
            fa.triggered.connect(lambda _, n=fname: self.set_font_style(n))
            self.font_menu.addAction(fa)
            self.font_actions[fname] = fa

        a_name = self.more_menu.addAction("Ubah nama di Home…")
        a_name.triggered.connect(self.edit_user_name)
        a_city = self.more_menu.addAction("Atur kota cuaca…")
        a_city.triggered.connect(self.edit_weather_city)

        self.scale_menu = self.more_menu.addMenu("Ukuran")
        self.scale_menu.setStyleSheet(self.menu_css())
        self.scale_actions = {}
        for name, val in UI_SCALES.items():
            act = QAction(f"{name} ({int(val * 100)}%)", self)
            act.setCheckable(True)
            act.setChecked(abs(val - UI_SCALE) < 0.01)
            act.triggered.connect(lambda _, n=name: self.set_ui_scale(n))
            self.scale_menu.addAction(act)
            self.scale_actions[name] = act
        self.more_menu.addSeparator()

        a_hide = QAction("Sembunyikan ke Tray", self)
        a_hide.triggered.connect(self.hide)
        self.act_startup = QAction("Auto-Startup Windows", self)
        self.act_startup.setCheckable(True)
        self.act_startup.triggered.connect(self.toggle_startup)
        a_quit = QAction("Keluar", self)
        a_quit.triggered.connect(QApplication.instance().quit)
        self.more_menu.addAction(a_hide)
        self.more_menu.addAction(self.act_startup)
        self.more_menu.addSeparator()
        self.more_menu.addAction(a_quit)

        self.stack = QStackedWidget()
        self.stack.addWidget(self.page_home())
        self.stack.addWidget(self.page_music())
        self.stack.addWidget(self.page_todo())
        self.stack.addWidget(self.page_notes())
        self.stack.addWidget(self.page_clipboard())
        self.stack.addWidget(self.page_shortcuts())
        self.stack.addWidget(self.page_focus())
        root.addWidget(self.stack, 1)

        self.switch_tab(0)
        self.refresh_todo_ui()
        self.refresh_drop_ui()
        self.refresh_shortcuts_ui()
        self.refresh_music_ui()

    def page_music(self):
        page = QWidget()
        lay = QHBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        lay.setSpacing(14)

        self.art_big = ArtWidget(120, 20)
        lay.addWidget(self.art_big, 0, Qt.AlignmentFlag.AlignTop)

        col = QVBoxLayout()
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(0)

        self.lbl_exp_title = ElideLabel("Tidak ada musik", 17, QFont.Weight.Bold, tracking=-0.3)
        self.lbl_exp_title.setFixedHeight(24)
        self.lbl_exp_artist = ElideLabel("", 12, QFont.Weight.Normal,
                                         QColor(255, 255, 255, 145), tracking=0.1)
        self.lbl_exp_artist.setFixedHeight(18)
        col.addWidget(self.lbl_exp_title)
        col.addWidget(self.lbl_exp_artist)
        col.addSpacing(10)

        prog_row = QHBoxLayout()
        prog_row.setContentsMargins(0, 0, 0, 0)
        prog_row.setSpacing(8)
        time_css = "color:rgba(255,255,255,0.62);background:transparent;"
        self.lbl_pos = QLabel("00:00")
        self.lbl_pos.setFont(make_font(10, QFont.Weight.Medium, numeric=True))
        self.lbl_pos.setStyleSheet(time_css)
        self.lbl_pos.setFixedWidth(34)
        self.lbl_pos.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.seek_bar = SeekBar()
        self.seek_bar.seekRequested.connect(self.on_seek_requested)
        self.lbl_dur = QLabel("--:--")
        self.lbl_dur.setFont(make_font(10, QFont.Weight.Medium, numeric=True))
        self.lbl_dur.setStyleSheet(time_css)
        self.lbl_dur.setFixedWidth(34)
        self.lbl_dur.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        prog_row.addWidget(self.lbl_pos)
        prog_row.addWidget(self.seek_bar, 1)
        prog_row.addWidget(self.lbl_dur)
        col.addLayout(prog_row)

        col.addStretch()

        ctrl = QHBoxLayout()
        ctrl.setContentsMargins(0, 0, 0, 0)
        ctrl.setSpacing(4)
        b_prev = IconButton("prev", 32, 14, round_=True)
        self.btn_play = IconButton("play", 40, 17, round_=True)
        self.btn_play.set_css("#FFFFFF", "#000000", "rgba(255,255,255,0.88)", "rgba(255,255,255,0.7)")
        b_next = IconButton("next", 32, 14, round_=True)
        self.btn_repeat = IconButton("repeat", 30, 13, round_=True)
        self.btn_repeat.setToolTip("Repeat")
        self.btn_lyrics = IconButton("lyrics", 30, 13, round_=True)
        self.btn_lyrics.setToolTip("Tampilkan / sembunyikan lirik")

        b_prev.clicked.connect(lambda: self.media_cmd("prev", VK_MEDIA_PREV_TRACK))
        self.btn_play.clicked.connect(self.on_play_clicked)
        b_next.clicked.connect(lambda: self.media_cmd("next", VK_MEDIA_NEXT_TRACK))
        self.btn_repeat.clicked.connect(self.on_repeat_clicked)
        self.btn_lyrics.clicked.connect(self.toggle_lyrics_panel)

        ctrl.addWidget(b_prev)
        ctrl.addWidget(self.btn_play)
        ctrl.addWidget(b_next)
        ctrl.addSpacing(8)
        ctrl.addWidget(self.btn_repeat)
        ctrl.addWidget(self.btn_lyrics)
        ctrl.addStretch()

        vseg, vl = make_segment(15)
        vl.setSpacing(0)
        for name, vk in (("vol_down", VK_VOLUME_DOWN), ("mute", VK_VOLUME_MUTE), ("vol_up", VK_VOLUME_UP)):
            vb = IconButton(name, 24, 11, round_=True)
            vb.clicked.connect(lambda _, k=vk: self.send_media_key(k))
            vl.addWidget(vb)
        ctrl.addWidget(vseg)
        col.addLayout(ctrl)
        col.addSpacing(8)

        src = QHBoxLayout()
        src.setContentsMargins(0, 0, 0, 0)
        src.setSpacing(8)
        seg2, s2 = make_segment(14)
        self.btn_src_all = seg_button("Semua")
        self.btn_src_spotify = seg_button("Spotify")
        self.btn_src_browser = seg_button("Browser")
        self.btn_src_all.clicked.connect(lambda: self.switch_music_source("Semua"))
        self.btn_src_spotify.clicked.connect(lambda: self.switch_music_source("Spotify"))
        self.btn_src_browser.clicked.connect(lambda: self.switch_music_source("Browser"))
        s2.addWidget(self.btn_src_all)
        s2.addWidget(self.btn_src_spotify)
        s2.addWidget(self.btn_src_browser)

        self.lbl_active_player = ElideLabel("Player: Menunggu", 10, QFont.Weight.Medium,
                                            QColor(255, 255, 255, 135))
        self.lbl_active_player.setFixedHeight(24)

        b_open = IconButton("open", 26, 12, round_=True)
        b_open.setToolTip("Buka pemutar musik")
        b_open.clicked.connect(lambda: self.open_music_app(autoplay=False))

        src.addWidget(seg2)
        src.addWidget(self.lbl_active_player, 1)
        src.addWidget(b_open)
        col.addLayout(src)

        lay.addLayout(col, 1)

        self.lyrics_panel = LyricsPanel()
        self.lyrics_panel.setFixedWidth(0)
        self.lyrics_panel.hide()
        self.lyrics_panel.set_offset(self.lyrics_offset)
        self.lyrics_panel.offsetChanged.connect(self.on_lyrics_offset)
        self.lyrics_anim = QVariantAnimation(self)
        self.lyrics_anim.setDuration(260)
        self.lyrics_anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self.lyrics_anim.valueChanged.connect(self._on_lyrics_anim)
        self.lyrics_anim.finished.connect(self._on_lyrics_anim_done)
        lay.addWidget(self.lyrics_panel)

        return page

    def exp_target_w(self):
        on_music = self.stack.currentIndex() == self.TAB_MUSIC
        w = self.EXP_W + (self.LYR_W + 14 if (self.lyrics_open and on_music) else 0)
        return min(w, max(self.EXP_W, self.screen_w - 40))

    def toggle_lyrics_panel(self):
        self.lyrics_open = not self.lyrics_open
        self.refresh_music_ui()
        self.lyrics_anim.stop()
        self.lyrics_anim.setStartValue(self.lyrics_panel.width())
        if self.lyrics_open:
            self.lyrics_panel.show()
            self.lyrics_anim.setEndValue(self.LYR_W)
        else:
            self.lyrics_anim.setEndValue(0)
        self.lyrics_anim.start()
        # Pulau ikut melebar/menyempit supaya kontrol tidak terhimpit panel lirik
        if self.is_expanded:
            self.animate_to(self.exp_target_w(), self.EXP_H, self.EXP_RB, "resize", 260,
                            QEasingCurve(QEasingCurve.Type.OutCubic))

    def on_lyrics_offset(self, delta):
        self.lyrics_offset = round(max(-10.0, min(10.0, self.lyrics_offset + delta)), 1)
        self.lyrics_panel.set_offset(self.lyrics_offset)
        self.save_data()
        self.show_toast(f"Lirik {self.lyrics_offset:+.1f} dtk")

    def _on_lyrics_anim(self, val):
        self.lyrics_panel.setFixedWidth(int(val))

    def _on_lyrics_anim_done(self):
        if not self.lyrics_open:
            self.lyrics_panel.hide()

    def page_todo(self):
        page = QWidget()
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        lay.setSpacing(6)

        row = QHBoxLayout()
        row.setSpacing(6)
        self.todo_input = QLineEdit()
        self.todo_input.setFont(make_font(12, QFont.Weight.Medium))
        self.todo_input.setPlaceholderText("Target skripsi hari ini, lalu Enter…")
        self.todo_input.setFixedHeight(30)
        self.todo_input.returnPressed.connect(self.add_todo)
        b_add = IconButton("add", 30, 13)
        b_add.set_css("rgba(255,255,255,0.12)", "#fff", "rgba(255,255,255,0.2)", "rgba(255,255,255,0.28)")
        b_add.clicked.connect(self.add_todo)
        b_clear = IconButton("trash", 30, 12)
        b_clear.setToolTip("Hapus yang sudah selesai")
        b_clear.clicked.connect(self.clear_completed_todos)
        row.addWidget(self.todo_input, 1)
        row.addWidget(b_add)
        row.addWidget(b_clear)
        lay.addLayout(row)

        self.progress_bar = QProgressBar()
        self.progress_bar.setFixedHeight(4)
        self.progress_bar.setTextVisible(False)
        lay.addWidget(self.progress_bar)

        self.todo_list = QListWidget()
        self.todo_list.setStyleSheet(list_css())
        self.todo_list.setItemDelegate(TodoDelegate(self))
        self.todo_list.setMouseTracking(True)
        self.todo_list.itemClicked.connect(self.toggle_todo_item)
        lay.addWidget(self.todo_list, 1)
        return page

    def page_notes(self):
        page = QWidget()
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        self.sticky_edit = QTextEdit()
        self.sticky_edit.setFont(make_font(12, QFont.Weight.Medium))
        self.sticky_edit.setPlaceholderText("Catatan revisi dosen, ide bab, atau reminder cepat (tersimpan otomatis)…")
        self.sticky_edit.setPlainText(self.data.get("sticky", ""))
        self.save_timer = QTimer(self)
        self.save_timer.setSingleShot(True)
        self.save_timer.setInterval(600)
        self.save_timer.timeout.connect(self.save_data)
        self.sticky_edit.textChanged.connect(self.save_timer.start)
        lay.addWidget(self.sticky_edit)
        return page

    def page_clipboard(self):
        page = QWidget()
        lay = QHBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        lay.setSpacing(10)

        c1 = QVBoxLayout()
        c1.setSpacing(5)
        c1.addWidget(label("RIWAYAT SALIN · KLIK = SALIN"))
        self.clip_list = QListWidget()
        self.clip_list.setFont(make_font(11, QFont.Weight.Medium))
        self.clip_list.setStyleSheet(list_css())
        self.clip_list.itemClicked.connect(self.copy_from_history)
        c1.addWidget(self.clip_list, 1)

        c2 = QVBoxLayout()
        c2.setSpacing(5)
        h = QHBoxLayout()
        h.addWidget(label("RAK FILE · TARIK KE SINI"))
        h.addStretch()
        b = IconButton("trash", 20, 10)
        b.setToolTip("Bersihkan rak")
        b.clicked.connect(self.clear_dropped_files)
        h.addWidget(b)
        c2.addLayout(h)
        self.drop_list = QListWidget()
        self.drop_list.setFont(make_font(11, QFont.Weight.Medium))
        self.drop_list.setStyleSheet(list_css())
        self.drop_list.itemClicked.connect(self.open_dropped_file)
        c2.addWidget(self.drop_list, 1)

        lay.addLayout(c1, 1)
        lay.addLayout(c2, 1)
        return page

    def page_shortcuts(self):
        page = QWidget()
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        lay.setSpacing(6)

        hdr = QHBoxLayout()
        hdr.addWidget(label("SHORTCUT · TARIK APP / FILE / FOLDER KE SINI"))
        hdr.addStretch()
        btn_clr = IconButton("trash", 22, 11)
        btn_clr.setToolTip("Hapus semua shortcut")
        btn_clr.clicked.connect(self.clear_all_shortcuts)
        hdr.addWidget(btn_clr)
        lay.addLayout(hdr)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet(
            "QScrollArea{background:transparent;border:none;}"
            "QScrollBar:vertical{background:transparent;width:5px;}"
            "QScrollBar::handle:vertical{background:rgba(255,255,255,0.2);border-radius:2px;}"
        )
        self.sc_container = QWidget()
        self.sc_container.setStyleSheet("background:transparent;")
        self.sc_grid = QGridLayout(self.sc_container)
        self.sc_grid.setContentsMargins(0, 0, 0, 0)
        self.sc_grid.setSpacing(8)
        scroll.setWidget(self.sc_container)
        lay.addWidget(scroll, 1)
        return page

    def refresh_shortcuts_ui(self):
        while self.sc_grid.count():
            it = self.sc_grid.takeAt(0)
            if it.widget():
                it.widget().deleteLater()

        if not self.shortcuts:
            empty = QLabel("Tarik & lepas aplikasi (.exe/.lnk), file skripsi, atau folder ke area ini\nuntuk membuat shortcut 4 kolom.\n(Klik kiri: Buka · Klik kanan: Hapus)")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setFont(make_font(11, QFont.Weight.Medium))
            empty.setStyleSheet(
                "color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.04);"
                "border:1px dashed rgba(255,255,255,0.16);border-radius:14px;padding:22px;"
            )
            self.sc_grid.addWidget(empty, 0, 0, 1, 4)
            return

        for idx, path_str in enumerate(self.shortcuts):
            r, c = divmod(idx, 4)
            card = ShortcutCard(path_str, self.icon_provider)
            card.clicked.connect(lambda _, p=path_str: self.open_shortcut_item(p))
            card.removed.connect(self.remove_shortcut_item)
            self.sc_grid.addWidget(card, r, c)

        for c in range(4):
            self.sc_grid.setColumnStretch(c, 1)

    def open_shortcut_item(self, path_str):
        if path_str and os.path.exists(path_str):
            try:
                os.startfile(path_str)
            except Exception:
                pass
        else:
            self.show_toast("Lokasi file tidak ditemukan")

    def remove_shortcut_item(self, path_str):
        if path_str in self.shortcuts:
            self.shortcuts.remove(path_str)
            self.refresh_shortcuts_ui()
            self.save_data()
            self.show_toast("Shortcut dihapus")

    def clear_all_shortcuts(self):
        self.shortcuts.clear()
        self.refresh_shortcuts_ui()
        self.save_data()

    def page_focus(self):
        page = QWidget()
        lay = QHBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        lay.setSpacing(24)

        self.ring = RingWidget()
        lay.addWidget(self.ring, 0, Qt.AlignmentFlag.AlignVCenter)

        col = QVBoxLayout()
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(8)
        col.addStretch()

        col.addWidget(label("SESI FOKUS"))
        self.btn_pomo = QPushButton("Mulai")
        self.btn_pomo.setFont(make_font(12, QFont.Weight.Bold, 0.3))
        self.btn_pomo.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_pomo.setFixedHeight(34)
        self.btn_pomo.clicked.connect(self.toggle_pomodoro)
        col.addWidget(self.btn_pomo)

        presets = QHBoxLayout()
        presets.setSpacing(6)
        for text, mins in [("25m Fokus", 25), ("50m Deep", 50), ("5m Rehat", 5)]:
            b = pill_button(text)
            b.clicked.connect(lambda _, m=mins: self.set_pomodoro(m))
            presets.addWidget(b, 1)
        col.addLayout(presets)

        col.addSpacing(6)
        col.addWidget(label("TOOLS"))
        tools = QHBoxLayout()
        tools.setSpacing(6)
        for text, fn in [
            ("Kalkulator", lambda: os.startfile("calc.exe")),
            ("Explorer", lambda: os.startfile(str(Path.home()))),
            ("Kunci Layar", lambda: ctypes.windll.user32.LockWorkStation()),
        ]:
            b = pill_button(text)
            b.clicked.connect(lambda _, f=fn: f())
            tools.addWidget(b, 1)
        col.addLayout(tools)
        col.addStretch()
        lay.addLayout(col, 1)
        self.update_timer_ui()
        return page

    def switch_tab(self, index):
        self.stack.setCurrentIndex(index)
        a = self.accent
        for i, b in enumerate(self.tab_buttons):
            if i == index:
                b.set_css("transparent", "#FFFFFF", "transparent", "rgba(255,255,255,0.10)")
            else:
                b.set_css("transparent", "rgba(255,255,255,0.58)",
                          "rgba(255,255,255,0.08)", "rgba(255,255,255,0.14)")
        # sorotan tab yang meluncur halus mengikuti tab aktif
        self.tab_hl.setStyleSheet(
            "QFrame{background:qlineargradient(x1:0,y1:0,x2:1,y2:1,"
            f"stop:0 {rgba(a, 0.62)},stop:1 {rgba(a, 0.30)});"
            "border:1px solid rgba(255,255,255,0.12);border-radius:13px;}")
        target = QRect(3 + index * 36, 2, 34, 26)
        if self.tab_hl.geometry() != target:
            self.tab_hl_anim.stop()
            if self.isVisible() and self.is_expanded:
                self.tab_hl_anim.setStartValue(self.tab_hl.geometry())
                self.tab_hl_anim.setEndValue(target)
                self.tab_hl_anim.start()
            else:
                self.tab_hl.setGeometry(target)
        # lebar pulau mengikuti tab (panel lirik hanya ada di tab Musik)
        busy = (self.anim.state() == QVariantAnimation.State.Running
                and self.anim_mode in ("expand", "collapse"))
        if self.is_expanded and not busy and abs(self.cur[0] - self.exp_target_w()) > 1:
            self.animate_to(self.exp_target_w(), self.EXP_H, self.EXP_RB, "resize", 260,
                            QEasingCurve(QEasingCurve.Type.OutCubic))

    def show_more_menu(self):
        self.act_startup.setChecked(STARTUP_BAT.exists())
        self.menu_open = True
        self.more_menu.exec(self.btn_more.mapToGlobal(self.btn_more.rect().bottomLeft()))
        self.menu_open = False

    def toggle_pin(self):
        self.is_pinned = not self.is_pinned
        if self.is_pinned:
            self.btn_pin.set_css("rgba(255,159,10,0.28)", "#FF9F0A", "rgba(255,159,10,0.38)", "rgba(255,159,10,0.46)")
        else:
            self.btn_pin.set_css()

    def trigger_screenshot(self):
        self.hover_block_until = time.monotonic() + 2.5
        self.collapse_island()
        webbrowser.open("ms-screenclip:")

    def toggle_startup(self):
        if STARTUP_BAT.exists():
            try:
                STARTUP_BAT.unlink()
            except Exception:
                pass
        else:
            if getattr(sys, "frozen", False):
                bat = f'@echo off\nstart "" "{Path(sys.executable).resolve()}"\n'
            else:
                py = Path(sys.executable)
                pyw = py.parent / "pythonw.exe"
                exe = pyw if pyw.exists() else py
                bat = f'@echo off\nstart "" "{exe}" "{Path(__file__).resolve()}"\n'
            try:
                with open(STARTUP_BAT, "w", encoding="utf-8") as f:
                    f.write(bat)
            except Exception:
                pass
        self.show_toast("Auto-Start " + ("aktif" if STARTUP_BAT.exists() else "nonaktif"))

    def switch_music_source(self, source):
        self.music_source = source
        self.bridge.prefer = source
        self.refresh_source_buttons()
        self.poll_system_and_media()
        self.save_data()

    def refresh_source_buttons(self):
        a = self.accent

        def css(active):
            if active:
                return (f"QPushButton{{background:{rgba(a, 0.34)};color:#fff;border:none;"
                        "border-radius:10px;padding:0 10px;}")
            return ("QPushButton{background:transparent;color:rgba(255,255,255,0.65);border:none;"
                    "border-radius:10px;padding:0 10px;}"
                    "QPushButton:hover{background:rgba(255,255,255,0.1);color:#fff;}")

        self.btn_src_all.setStyleSheet(css(self.music_source == "Semua"))
        self.btn_src_spotify.setStyleSheet(css(self.music_source == "Spotify"))
        self.btn_src_browser.setStyleSheet(css(self.music_source == "Browser"))

    def send_media_key(self, vk):
        ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
        ctypes.windll.user32.keybd_event(vk, 0, 2, 0)

    def media_cmd(self, name, vk):
        self.user_skip_until = time.monotonic() + 4
        if self.bridge.available and self.bridge.get_state() is not None:
            self.bridge.command(name)
            QTimer.singleShot(450, self.poll_system_and_media)
        else:
            self.send_media_key(vk)

    def on_seek_requested(self, target_sec):
        self.song_pos = target_sec
        self.song_sampled_at = time.monotonic()
        self.seek_hold_until = time.monotonic() + 1.5
        self.local_pos = target_sec
        if self.bridge.available:
            self.bridge.command("seek", target_sec)
        self.update_playback_progress_ui()

    def on_play_clicked(self):
        st = self.bridge.get_state() if self.bridge.available else None
        if st is not None:
            self.bridge.command("toggle")
            QTimer.singleShot(450, self.poll_system_and_media)
        elif self.has_track:
            self.send_media_key(VK_MEDIA_PLAY_PAUSE)
        else:
            self.open_music_app(autoplay=True)

    def on_repeat_clicked(self):
        st = self.bridge.get_state() if self.bridge.available else None
        if st is None and not self.has_track:
            self.show_toast("Belum ada musik diputar")
            return
        if st is not None and REPEAT_ENUM_OK and st.get("repeat_ok"):
            nxt = {0: 2, 2: 1, 1: 0}.get(st.get("repeat", 0), 0)
            self.bridge.command("repeat")
            self.show_toast({0: "Repeat: mati", 2: "Repeat: semua lagu", 1: "Repeat: satu lagu"}[nxt])
            QTimer.singleShot(450, self.poll_system_and_media)
        else:
            self.soft_repeat = not self.soft_repeat
            self.show_toast("Repeat lagu: aktif" if self.soft_repeat else "Repeat lagu: mati")
            self.refresh_music_ui()
            self.refresh_compact()

    def open_music_app(self, autoplay=False):
        if autoplay:
            self.autoplay_until = time.monotonic() + 25
        if self.music_source == "Spotify":
            try:
                os.startfile("spotify:")
            except OSError:
                webbrowser.open("https://open.spotify.com")
            self.show_toast("Membuka Spotify…")
        else:
            webbrowser.open("https://music.youtube.com")
            self.show_toast("Membuka YouTube Music…")

    def set_art(self, data):
        key = hash(data) if data else None
        if key == self.art_key:
            return
        self.art_key = key
        pm = None
        if data:
            tmp = QPixmap()
            if tmp.loadFromData(data):
                pm = tmp
        self.art_big.set_pixmap(pm)
        self.art_small.set_pixmap(pm)

    def effective_repeat_mode(self):
        native = self.bridge.available and REPEAT_ENUM_OK and self.repeat_ok
        return self.repeat_mode if native else (1 if self.soft_repeat else 0)

    def refresh_music_ui(self):
        if self.has_track:
            self.lbl_exp_title.setText(self.current_title or "Tanpa judul")
            self.lbl_exp_artist.setText(self.current_artist or self.playing_source)
            self.lbl_active_player.setText(f"Aktif: {self.playing_source}")
        else:
            self.lbl_exp_title.setText("Tidak ada musik")
            self.lbl_exp_artist.setText("Putar lagu di aplikasi atau browser mana saja")
            self.lbl_active_player.setText("Player: Menunggu")
        self.art_big.set_state(self.has_track)
        self.art_small.set_state(self.has_track)
        self.btn_play.set_icon("pause" if self.is_playing else "play")
        self.bars.active = self.is_playing

        a = self.accent
        mode = self.effective_repeat_mode()
        self.btn_repeat.set_icon("repeat_one" if mode == 1 else "repeat")
        if mode:
            self.btn_repeat.set_css(rgba(a, 0.3), "#FFFFFF", rgba(a, 0.4), rgba(a, 0.5))
        else:
            self.btn_repeat.set_css()

        if self.lyrics_open:
            self.btn_lyrics.set_css(rgba(a, 0.34), "#FFFFFF", rgba(a, 0.44), rgba(a, 0.52))
        else:
            self.btn_lyrics.set_css()

    def current_position(self):
        now = time.monotonic()
        if self.has_timeline:
            pos = self.song_pos + ((now - self.song_sampled_at) if self.is_playing else 0.0)
            if self.song_dur > 0:
                pos = min(self.song_dur, pos)
            return max(0.0, pos)
        return self.local_pos   # pemutar tidak melaporkan posisi: pakai jam lokal

    def advance_local_clock(self):
        now = time.monotonic()
        dt = now - self._clock_t
        self._clock_t = now
        if not self.has_timeline and self.is_playing and self.has_track:
            self.local_pos += min(dt, 0.5)

    def update_playback_progress_ui(self):
        live = self.current_position() if self.has_track else 0.0
        dur = self.song_dur if (self.has_timeline and self.song_dur > 0) else 0.0
        self.seek_bar.set_progress(live, dur)
        self.lbl_pos.setText(fmt_sec(live))
        self.lbl_dur.setText(fmt_sec(dur) if dur > 0 else "--:--")

        if self.lyrics_open:
            lines, status = self.lyrics_fetcher.get_lyrics()
            self.lyrics_panel.update_state(lines, status, live + self.lyrics_offset)

    def poll_system_and_media(self):
        now = time.monotonic()
        if self.bridge.available:
            st = self.bridge.get_state()
            if st and (st["title"] or st["artist"]):
                self.has_track = True
                self.current_title, self.current_artist = st["title"], st["artist"]
                self.playing_source = st["source"]
                self.is_playing = st["playing"]
                self.repeat_mode = st.get("repeat", 0)
                self.repeat_ok = st.get("repeat_ok", False)
                self.has_timeline = bool(st.get("has_timeline"))
                if now >= self.seek_hold_until:
                    self.song_pos = st.get("position", 0.0)
                    self.song_dur = st.get("duration", 0.0)
                    self.song_sampled_at = st.get("sampled_at", now)
                self.set_art(st["thumb"])
            else:
                self.has_track = False
                self.is_playing = False
                self.repeat_ok = False
                self.current_title = self.current_artist = ""
                self.song_pos = self.song_dur = 0.0
                self.has_timeline = False
                self.local_pos = 0.0
                self.set_art(b"")
            if self.autoplay_until:
                if now > self.autoplay_until or (st and st["playing"]):
                    self.autoplay_until = 0
                elif st:
                    self.bridge.command("play")
        else:
            media = detect_playing_media()
            if media:
                src, (t, ar) = next(iter(media.items()))
                self.playing_source, self.current_title, self.current_artist = src, t, ar
                self.has_track = self.is_playing = True
            else:
                self.has_track = self.is_playing = False
                self.current_title = self.current_artist = ""
            self.repeat_ok = False
            self.has_timeline = False
            self.song_dur = 0.0
            self.set_art(b"")

        self.lyrics_fetcher.request_track(self.current_title, self.current_artist, self.song_dur)

        key = (self.current_title, self.current_artist) if self.has_track else None
        if key != self.last_track_key:
            prev_key = self.last_track_key
            self.last_track_key = key
            self.local_pos = 0.0
            if (self.soft_repeat and key is not None and prev_key is not None
                    and self.was_playing and now > self.user_skip_until and self.bridge.available):
                self.bridge.command("prev")
                self.user_skip_until = now + 4
        self.was_playing = self.is_playing

        if self.is_playing:
            self.last_play_time = now
        self.track_visible = self.has_track and (self.is_playing or now - self.last_play_time < 30)
        self.refresh_music_ui()

        self.batt_pct, self.charging = get_battery_info()
        if self.last_charging_state is not None and self.charging != self.last_charging_state:
            self.show_toast("Charger terhubung" if self.charging else "Mode baterai")
        self.last_charging_state = self.charging
        self.lbl_batt.setText(f"{self.batt_pct}%" + (" · ⚡" if self.charging else ""))

        if psutil:
            self.sys_text = f"CPU {int(psutil.cpu_percent())}%  ·  RAM {int(psutil.virtual_memory().percent)}%"
        else:
            self.sys_text = "FlowIsland Pro Ready"
        self.refresh_status()
        self.refresh_compact()

    def refresh_status(self):
        self.lbl_status.setText(self.toast_message if self.toast_ticks > 0 else self.sys_text)

    def refresh_compact(self, animate=True):
        toast = self.toast_ticks > 0

        if self.chrome_active and not toast:
            self.eyes.show()
            self.art_small.hide()
            self.lbl_comp_title.hide()
            self.lbl_comp_timer.hide()
            self.lbl_clock.hide()
            self.lbl_rep.hide()
            self.bars.hide()
            w, h, rb = self.CHROME_W, self.CHROME_H, 10
        else:
            self.eyes.hide()
            show_media = toast or self.track_visible or self.timer_running

            self.art_small.setVisible(self.track_visible or toast)
            self.lbl_comp_title.setVisible(show_media)
            self.bars.setVisible(self.is_playing and not toast)
            self.lbl_comp_timer.setVisible(self.timer_running and not toast)
            self.lbl_clock.setVisible(not toast)

            rmode = self.effective_repeat_mode()
            self.lbl_rep.set_icon("repeat_one" if rmode == 1 else "repeat")
            self.lbl_rep.set_color(QColor(self.accent))
            self.lbl_rep.setVisible(rmode != 0 and show_media and not toast)

            if show_media:
                self.compact_layout.setStretchFactor(self.lbl_clock, 0)
                self.lbl_clock.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            else:
                self.compact_layout.setStretchFactor(self.lbl_clock, 1)
                self.lbl_clock.setAlignment(Qt.AlignmentFlag.AlignCenter)

            if toast:
                self.lbl_comp_title.setText(self.toast_message)
                self.lbl_comp_title.set_color(QColor("#FFD60A"))
            elif self.track_visible:
                self.lbl_comp_title.setText(self.current_title)
                self.lbl_comp_title.set_color(QColor(255, 255, 255))
            elif self.timer_running:
                self.lbl_comp_title.setText("Fokus")
                self.lbl_comp_title.set_color(QColor(255, 255, 255))

            if not show_media:
                w = self.IDLE_W
            elif toast:
                w = self.TOAST_W
            else:
                w = self.ACTIVE_W + (self.TIMER_EXTRA if self.timer_running else 0)
            h, rb = self.COLLAPSED_H, self.COL_RB

        if animate and not self.is_expanded:
            running = self.anim.state() == QVariantAnimation.State.Running
            target_w, target_h, _ = self.anim_to if running else self.cur
            if (abs(target_w - w) > 1 or abs(target_h - h) > 1) and not (running and self.anim_mode in ("expand", "collapse")):
                self.animate_to(w, h, rb, "resize", 280, QEasingCurve(QEasingCurve.Type.OutCubic))
        return w, h, rb

    def on_clipboard_change(self):
        text = QApplication.clipboard().text().strip()
        if text and (not self.clipboard_history or self.clipboard_history[0] != text):
            if text in self.clipboard_history:
                self.clipboard_history.remove(text)
            self.clipboard_history.insert(0, text)
            self.clipboard_history = self.clipboard_history[:15]
            self.refresh_clip_ui()
            self.show_toast("Teks tersalin")

    def refresh_clip_ui(self):
        self.clip_list.clear()
        for t in self.clipboard_history:
            one = " ".join(t.splitlines())
            item = QListWidgetItem(one if len(one) <= 38 else one[:36] + "…")
            item.setData(Qt.ItemDataRole.UserRole, t)
            item.setToolTip(t[:300])
            self.clip_list.addItem(item)

    def copy_from_history(self, item):
        full = item.data(Qt.ItemDataRole.UserRole)
        if full:
            QApplication.clipboard().setText(full)
            self.show_toast("Disalin ulang")

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            if not self.is_expanded:
                self.expand_island()
                self.switch_tab(self.TAB_APPS)
            elif self.stack.currentIndex() not in (self.TAB_CLIP, self.TAB_APPS):
                self.switch_tab(self.TAB_APPS)

    def dropEvent(self, event):
        paths = [u.toLocalFile() for u in event.mimeData().urls() if u.toLocalFile()]
        if not paths:
            return

        if self.stack.currentIndex() == self.TAB_CLIP:
            for p in paths:
                if p not in self.dropped_files:
                    self.dropped_files.insert(0, p)
            self.dropped_files = self.dropped_files[:15]
            self.refresh_drop_ui()
            self.show_toast("Disimpan ke Rak File")
        else:
            self.switch_tab(self.TAB_APPS)
            for p in paths:
                if p not in self.shortcuts:
                    self.shortcuts.append(p)
            self.shortcuts = self.shortcuts[:24]
            self.refresh_shortcuts_ui()
            self.show_toast("Ditambahkan ke Shortcut")

        self.save_data()
        event.acceptProposedAction()

    def refresh_drop_ui(self):
        self.drop_list.clear()
        for path in self.dropped_files:
            item = QListWidgetItem(Path(path).name)
            item.setData(Qt.ItemDataRole.UserRole, path)
            item.setToolTip(path)
            self.drop_list.addItem(item)

    def open_dropped_file(self, item):
        path = item.data(Qt.ItemDataRole.UserRole)
        if path and os.path.exists(path):
            os.startfile(path)

    def clear_dropped_files(self):
        self.dropped_files.clear()
        self.refresh_drop_ui()
        self.save_data()

    def refresh_todo_ui(self):
        self.todo_list.clear()
        todos = self.data.get("todos", [])
        done = 0
        for idx, t in enumerate(todos):
            item = QListWidgetItem(t["text"])
            item.setData(Qt.ItemDataRole.UserRole, idx)
            item.setData(Qt.ItemDataRole.UserRole + 1, bool(t["done"]))
            if t["done"]:
                done += 1
            self.todo_list.addItem(item)
        total = len(todos)
        self.progress_bar.setValue(int(done / total * 100) if total else 0)

    def add_todo(self):
        text = self.todo_input.text().strip()
        if text:
            self.data["todos"].append({"text": text, "done": False})
            self.todo_input.clear()
            self.refresh_todo_ui()
            self.save_data()

    def toggle_todo_item(self, item):
        idx = item.data(Qt.ItemDataRole.UserRole)
        if 0 <= idx < len(self.data["todos"]):
            self.data["todos"][idx]["done"] = not self.data["todos"][idx]["done"]
            self.refresh_todo_ui()
            self.save_data()

    def clear_completed_todos(self):
        self.data["todos"] = [t for t in self.data["todos"] if not t["done"]]
        self.refresh_todo_ui()
        self.save_data()

    def update_timer_ui(self):
        mins, secs = divmod(self.time_left, 60)
        s = f"{mins:02d}:{secs:02d}"
        self.lbl_comp_timer.setText(s)
        self.ring.text = s
        self.ring.progress = self.time_left / self.time_total if self.time_total else 0
        if self.timer_running:
            self.ring.sub = "Berjalan"
        elif self.time_left == 0:
            self.ring.sub = "Selesai"
        else:
            self.ring.sub = "Siap" if self.time_left == self.time_total else "Jeda"
        self.btn_pomo.setText("Jeda" if self.timer_running else "Mulai")
        self.ring.update()

    def toggle_pomodoro(self):
        if self.time_left == 0:
            self.time_left = self.time_total
        self.timer_running = not self.timer_running
        self.update_timer_ui()
        self.refresh_compact()

    def set_pomodoro(self, minutes):
        self.timer_running = False
        self.time_total = minutes * 60
        self.time_left = self.time_total
        self.update_timer_ui()
        self.refresh_compact()

    # ── Timer & hover ──
    def setup_hooks_and_timers(self):
        QApplication.clipboard().dataChanged.connect(self.on_clipboard_change)

        self.bridge.start()
        self.lyrics_fetcher.start()
        self.weather.start()

        self.main_timer = QTimer(self)
        self.main_timer.timeout.connect(self.tick_second)
        self.main_timer.start(1000)

        self.eq_timer = QTimer(self)
        self.eq_timer.timeout.connect(self.anim_step)
        self.eq_timer.start(50)

        self.hover_timer = QTimer(self)
        self.hover_timer.timeout.connect(self.hover_tick)
        self.hover_timer.start(40)

        self.poll_system_and_media()

    def anim_step(self):
        self.advance_local_clock()
        self.bars.step()
        if self.chrome_active:
            self.eyes.step()
        if self.is_expanded:
            self.update_playback_progress_ui()

    def tick_second(self):
        self.tick_count += 1
        if self.toast_ticks > 0:
            self.toast_ticks -= 1
            if self.toast_ticks == 0:
                self.refresh_status()
        if self.timer_running:
            if self.time_left > 0:
                self.time_left -= 1
            if self.time_left == 0:
                self.timer_running = False
                self.show_toast("Sesi fokus selesai")
            self.update_timer_ui()
        self.lbl_clock.setText(datetime.now().strftime("%H:%M"))
        if self.is_expanded and self.stack.currentIndex() == self.TAB_HOME:
            self.home_view.update()

        # Mata berkedip tampil saat Chrome/Browser sedang jadi jendela aktif
        try:
            chrome_now = is_browser_foreground() and not self.is_expanded
        except Exception:
            chrome_now = False
        if chrome_now != self.chrome_active:
            self.chrome_active = chrome_now
            self.refresh_compact()

        if self.bridge.available or self.tick_count % 2 == 0:
            self.poll_system_and_media()
        else:
            self.refresh_compact()

    def can_collapse(self):
        if self.is_pinned or self.menu_open or QApplication.activePopupWidget():
            return False
        if self.isActiveWindow() and (self.todo_input.hasFocus() or self.sticky_edit.hasFocus()):
            return False
        return True

    def hover_tick(self):
        if not self.isVisible():
            return
        now = time.monotonic()
        w, h, _ = self.cur
        rect = QRect(self.x() + M, self.y(), int(w), int(h))
        pos = QCursor.pos()
        if self.is_expanded:
            inside = rect.adjusted(-6, 0, 6, 8).contains(pos)
        else:
            inside = rect.contains(pos) and now >= self.hover_block_until

        if inside:
            self.leave_since = None
            if not self.is_expanded:
                if self.enter_since is None:
                    self.enter_since = now
                elif now - self.enter_since >= 0.12:
                    self.enter_since = None
                    self.chrome_active = False
                    self.expand_island()
        else:
            self.enter_since = None
            if self.is_expanded and self.can_collapse():
                if self.leave_since is None:
                    self.leave_since = now
                elif now - self.leave_since >= 0.30:
                    self.leave_since = None
                    self.collapse_island()
            else:
                self.leave_since = None

    # ── Home ──
    def page_home(self):
        page = QWidget()
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 2, 0, 0)
        self.home_view = HomeView(self)
        self.home_view.nameClicked.connect(self.edit_user_name)
        self.home_view.weatherClicked.connect(self.edit_weather_city)
        self.home_view.musicClicked.connect(lambda: self.switch_tab(self.TAB_MUSIC))
        lay.addWidget(self.home_view)
        return page

    def edit_user_name(self):
        self.menu_open = True
        try:
            text, ok = QInputDialog.getText(None, "Nama kamu", "Nama yang ditampilkan di Home:",
                                            text=self.user_name)
        finally:
            self.menu_open = False
        if ok and text.strip():
            self.user_name = text.strip()[:24]
            self.save_data()
            self.home_view.update()

    def edit_weather_city(self):
        self.menu_open = True
        try:
            text, ok = QInputDialog.getText(None, "Cuaca", "Nama kota (mis. Samarinda):",
                                            text=self.weather.city())
        finally:
            self.menu_open = False
        if ok:
            self.weather.set_city(text.strip())
            self.data["weather_city"] = text.strip()
            self.save_data()
            self.home_view.update()

    # ── Latar kustom (gambar + gradien dinamis) ──
    def rebuild_custom(self):
        c = self.custom
        THEMES["Kustom"] = {"bg1": c["c1"], "bg2": c["c2"], "accent": c["c3"], "orn": "orbs"}
        self.custom_pix = None
        img = c.get("image") or ""
        if img and os.path.exists(img):
            pm = QPixmap(img)
            if not pm.isNull():
                big = pm.scaled(960, 360, Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                                Qt.TransformationMode.SmoothTransformation)
                self.custom_pix = blur_pixmap(big, 7) if c.get("blur", True) else big
        if getattr(self, "theme_name", None) == "Kustom":
            self.theme = THEMES["Kustom"]
            self.accent = c["c3"]

    def choose_custom_image(self):
        self.menu_open = True
        try:
            path, _ = QFileDialog.getOpenFileName(
                None, "Pilih gambar untuk tema", str(Path.home()),
                "Gambar (*.png *.jpg *.jpeg *.webp *.bmp)")
        finally:
            self.menu_open = False
        if not path:
            return
        pm = QPixmap(path)
        if pm.isNull():
            self.show_toast("Gambar tidak bisa dibuka")
            return
        self.custom.update(palette_from_pixmap(pm))
        self.custom["image"] = path
        self.rebuild_custom()
        self.apply_theme("Kustom")
        self.show_toast("Tema gambar dipakai")

    def choose_custom_colors(self):
        self.menu_open = True
        try:
            c3 = QColorDialog.getColor(QColor(self.custom["c3"]), None, "Warna aksen / gradien utama")
            if not c3.isValid():
                return
            c2 = QColorDialog.getColor(QColor(self.custom["c2"]), None, "Warna latar gradien")
            if not c2.isValid():
                return
        finally:
            self.menu_open = False
        self.custom["c3"] = c3.name()
        self.custom["c2"] = c2.name()
        self.custom["c1"] = c2.darker(280).name()
        self.rebuild_custom()
        self.apply_theme("Kustom")

    def clear_custom_image(self):
        self.custom["image"] = ""
        self.rebuild_custom()
        self.update()
        self.save_data()

    def set_custom_flag(self, key, value):
        self.custom[key] = bool(value)
        if key == "blur":
            self.rebuild_custom()
        self.update_bg_timer()
        self.update()
        self.save_data()

    def update_bg_timer(self):
        on = self.theme_name == "Kustom" and bool(self.custom.get("anim", True))
        if on and not self.bg_timer.isActive():
            self.bg_timer.start(45)
        elif not on and self.bg_timer.isActive():
            self.bg_timer.stop()

    def _bg_tick(self):
        if not self.isVisible():
            return
        self.bg_phase += 0.028
        self.update()

    def draw_custom_bg(self, p, w, h, path):
        c = self.custom
        p.save()
        p.setClipPath(path)
        rect = QRectF(M, 0, w, h)
        if self.custom_pix is not None:
            pm = self.custom_pix
            sc = max(w / pm.width(), h / pm.height())
            sw, sh = w / sc, h / sc
            src = QRectF((pm.width() - sw) / 2.0, (pm.height() - sh) / 2.0, sw, sh)
            p.drawPixmap(rect, pm, src)
            dim = QLinearGradient(0, 0, 0, h)
            dim.setColorAt(0.0, QColor(0, 0, 0, 125))
            dim.setColorAt(1.0, QColor(0, 0, 0, 170))
            p.fillRect(rect, QBrush(dim))

        t = self.bg_phase if c.get("anim", True) else 0.0
        cols = [QColor(c["c3"]), QColor(c["c2"]).lighter(150), QColor(c["c1"]).lighter(260)]
        blobs = [
            (0.18 + 0.22 * math.sin(t * 0.9), 0.30 + 0.30 * math.cos(t * 0.7), 0.60),
            (0.82 + 0.18 * math.cos(t * 0.8), 0.25 + 0.35 * math.sin(t * 1.1), 0.55),
            (0.50 + 0.30 * math.sin(t * 0.6 + 2.0), 0.95 + 0.25 * math.cos(t * 0.9), 0.65),
        ]
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_Screen)
        p.setPen(Qt.PenStyle.NoPen)
        for (bx, by, br), col in zip(blobs, cols):
            g = QRadialGradient(M + bx * w, by * h, max(w, h) * br)
            c0 = QColor(col)
            c0.setAlpha(105 if self.custom_pix is None else 70)
            c1 = QColor(col)
            c1.setAlpha(0)
            g.setColorAt(0.0, c0)
            g.setColorAt(1.0, c1)
            p.setBrush(QBrush(g))
            p.drawRect(rect)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)

        sx = M + (math.sin(t * 0.5) * 0.5 + 0.5) * w
        sw_ = QLinearGradient(sx - w * 0.3, 0, sx + w * 0.3, h)
        sw_.setColorAt(0.0, QColor(255, 255, 255, 0))
        sw_.setColorAt(0.5, QColor(255, 255, 255, 16))
        sw_.setColorAt(1.0, QColor(255, 255, 255, 0))
        p.fillRect(rect, QBrush(sw_))
        p.restore()

    def set_font_style(self, name):
        self.data["font_style"] = name
        for n, act in self.font_actions.items():
            act.setChecked(n == name)
        self.save_data()
        self.show_toast("Font baru: buka ulang app")



if __name__ == "__main__":
    UI_SCALE = load_ui_scale()
    os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "1"
    os.environ["QT_SCALE_FACTOR"] = f"{UI_SCALE:.3f}"
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    load_custom_fonts()
    set_font_style_global(load_font_style())
    ICON_FONT = pick_icon_font()
    app.setFont(make_font(12))
    app.setStyleSheet(
        "QToolTip{background:#0E0E10;color:#F5F5F7;border:1px solid rgba(255,255,255,0.14);"
        "padding:4px 8px;}")
    island = FlowIslandPro()
    island.show()
    sys.exit(app.exec())