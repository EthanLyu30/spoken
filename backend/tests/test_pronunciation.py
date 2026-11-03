import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import audio as audio_api
from app.api.pronunciation import get_ise_client
from app.main import app
from app.services.xf_ise import XfIseError

client = TestClient(app)

SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<xml_result>
  <read_sentence lan="en">
    <rec_paper>
      <read_chapter total_score="4.5" accuracy_score="4.4" fluency_score="4.8" integrity_score="5.0" standard_score="4.2" word_count="2" content="hi there">
        <sentence total_score="4.5" accuracy_score="4.4">
          <word content="hi" total_score="4.6"><syll content="h ay"><phone content="h" dp_message="0"/><phone content="ay" dp_message="16"/></syll></word>
          <word content="fil" beg_pos="1" end_pos="2"/>
          <word content="there" total_score="4.0"></word>
        </sentence>
      </read_chapter>
    </rec_paper>
  </read_sentence>
</xml_result>"""


class _StubIse:
    def __init__(self, xml: str = SAMPLE_XML) -> None:
        self.xml = xml

    async def evaluate_raw(self, text, pcm, **_kwargs):
        return self.xml


def test_pronunciation_parses_scores():
    app.dependency_overrides[get_ise_client] = lambda: _StubIse()
    try:
        resp = client.post("/api/pronunciation?text=hi%20there", content=b"\x00\x01\x02")
        assert resp.status_code == 200
        body = resp.json()
        assert body["overall"] == 90.0
        assert body["integrity"] == 100.0
        assert [w["word"] for w in body["words"]] == ["hi", "there"]
        assert body["words"][0]["score"] == 92.0
        # phoneme-level detail: "h" ok, "ay" flagged (dp_message != 0)
        assert body["words"][0]["phonemes"] == [
            {"label": "h", "ok": True},
            {"label": "ay", "ok": False},
        ]
    finally:
        app.dependency_overrides.clear()


def test_pronunciation_requires_text():
    resp = client.post("/api/pronunciation?text=", content=b"\x00\x01")
    assert resp.status_code == 400


def test_pronunciation_empty_audio():
    resp = client.post("/api/pronunciation?text=hi", content=b"")
    assert resp.status_code == 400


@pytest.mark.parametrize("text", ["   ", "x" * 2001, "  " + "x" * 2001 + "  "])
def test_pronunciation_rejects_text_outside_trimmed_bounds(text):
    resp = client.post("/api/pronunciation", params={"text": text}, content=b"\x00\x01")
    assert resp.status_code == 400


def test_pronunciation_rejects_unsupported_language_and_oversized_audio(monkeypatch):
    monkeypatch.setattr(audio_api, "MAX_AUDIO_BYTES", 4)

    class _Unexpected:
        async def evaluate_raw(self, *args, **kwargs):
            raise AssertionError("provider must not receive invalid input")

    app.dependency_overrides[get_ise_client] = lambda: _Unexpected()
    try:
        invalid_language = client.post(
            "/api/pronunciation", params={"text": "hi", "language": "fr"}, content=b"\x00\x01"
        )
        oversized = client.post("/api/pronunciation", params={"text": "hi"}, content=b"\x00" * 6)
        assert invalid_language.status_code == 400
        assert oversized.status_code == 413
    finally:
        app.dependency_overrides.clear()


def test_pronunciation_accepts_exact_trimmed_text_and_audio_limits(monkeypatch):
    monkeypatch.setattr(audio_api, "MAX_AUDIO_BYTES", 4)
    seen = {}

    class _Stub(_StubIse):
        async def evaluate_raw(self, text, pcm, **kwargs):
            seen.update(text=text, pcm=pcm)
            return self.xml

    app.dependency_overrides[get_ise_client] = lambda: _Stub()
    try:
        resp = client.post(
            "/api/pronunciation", params={"text": "  " + "x" * 2000 + "  "}, content=b"\x00" * 4
        )
        assert resp.status_code == 200
        assert seen == {"text": "x" * 2000, "pcm": b"\x00" * 4}
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("entry", [None, "turn_correction", "follow_read"])
def test_pronunciation_entry_is_content_free_request_telemetry(entry):
    records = []
    previous_sink = getattr(app.state, "telemetry_sink", None)
    app.state.telemetry_sink = SimpleNamespace(submit=records.append)
    seen = {}

    class _Stub(_StubIse):
        async def evaluate_raw(self, text, pcm, **kwargs):
            seen["text"] = text
            return await super().evaluate_raw(text, pcm, **kwargs)

    app.dependency_overrides[get_ise_client] = lambda: _Stub()
    try:
        params = {"text": "  hi there  "}
        if entry is not None:
            params["entry"] = entry
        resp = client.post("/api/pronunciation", params=params, content=b"\x00\x01")
        assert resp.status_code == 200
        assert seen["text"] == "hi there"
        request_spans = [
            span
            for record in records
            for span in json.loads(record["spans_json"])
            if span["name"] == "pronunciation.request"
        ]
        assert request_spans[-1]["attributes"]["entry"] == (entry or "unknown")
        assert "hi there" not in json.dumps(records, default=str)
    finally:
        app.state.telemetry_sink = previous_sink
        app.dependency_overrides.clear()


def test_pronunciation_service_error_503():
    class _Boom:
        async def evaluate_raw(self, text, pcm, **_kwargs):
            raise XfIseError("nope")

    app.dependency_overrides[get_ise_client] = lambda: _Boom()
    try:
        resp = client.post("/api/pronunciation?text=hi", content=b"\x00\x01")
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
