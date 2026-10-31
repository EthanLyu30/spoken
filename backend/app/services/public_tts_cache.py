"""Small lifespan-owned cache for complete audio of explicitly public fixed text."""
from collections import OrderedDict
from dataclasses import dataclass
import io
from time import monotonic
import wave

from app.data import scenarios
from app.data.tts_voices import normalize_cloud_voice
from app.services.xf_tts import SAMPLE_RATE

PREVIEW_TEXT = "Hi! I'm Pip. Let's practice English together — you've got this!"
MAX_ENTRIES = 16
MAX_BYTES = 4 * 1024 * 1024
TTL_SECONDS = 300


@dataclass(frozen=True)
class PublicKey:
    text: str
    vcn: str
    speed: int
    pitch: int
    volume: int = 80
    format: str = "raw-pcm16-mono/wav"
    sample_rate: int = SAMPLE_RATE
    version: str = "xf-v2-whole-1"


def public_key(text: str, scenario_id: str | None, *, vcn: str, speed: int, pitch: int) -> PublicKey | None:
    # Do not normalize text or infer publicity from caller-supplied scene content.
    # Unknown/custom scenarios and arbitrary words/replies never enter this cache.
    scenario = scenarios.get_scenario(scenario_id) if scenario_id else None
    if not ((scenario is not None and text == scenario.opening_line)
            or (scenario_id is None and text == PREVIEW_TEXT)):
        return None
    return PublicKey(text, normalize_cloud_voice(vcn), speed, pitch)


class PublicTtsCache:
    """Synchronous operations run on the owning app loop; no tasks/locks survive it."""
    def __init__(self, *, clock=monotonic):
        self._clock = clock
        self._entries: OrderedDict[PublicKey, tuple[float, bytes]] = OrderedDict()
        self._bytes = 0

    def clear(self):
        self._entries.clear()
        self._bytes = 0

    def _remove(self, key):
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._bytes -= len(entry[1])

    def _expire(self):
        now = self._clock()
        for key, (expires, _) in list(self._entries.items()):
            if expires <= now:
                self._remove(key)

    def get(self, key: PublicKey) -> bytes | None:
        self._expire()
        entry = self._entries.get(key)
        if entry is None:
            return None
        self._entries.move_to_end(key)
        return entry[1]

    def put(self, key: PublicKey, audio: bytes):
        if not isinstance(audio, bytes) or len(audio) > MAX_BYTES:
            return
        # Admission occurs only after successful whole synthesis. Also reject
        # malformed/empty containers so a partial result cannot become a hit.
        try:
            if audio[:4] != b"RIFF" or int.from_bytes(audio[4:8], "little") + 8 != len(audio):
                return
            with wave.open(io.BytesIO(audio)) as wav:
                frames = wav.getnframes()
                if (frames <= 0 or wav.getnchannels() != 1 or wav.getsampwidth() != 2
                        or wav.getframerate() != key.sample_rate
                        or len(wav.readframes(frames)) != frames * 2):
                    return
        except (wave.Error, EOFError):
            return
        self._expire()
        self._remove(key)
        while self._entries and (len(self._entries) >= MAX_ENTRIES or self._bytes + len(audio) > MAX_BYTES):
            self._remove(next(iter(self._entries)))
        self._entries[key] = (self._clock() + TTL_SECONDS, audio)
        self._bytes += len(audio)
