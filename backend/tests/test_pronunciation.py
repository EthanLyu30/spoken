from fastapi.testclient import TestClient

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
          <word content="hi" total_score="4.6"><syll content="h ay"><phone content="h"/></syll></word>
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
    finally:
        app.dependency_overrides.clear()


def test_pronunciation_requires_text():
    resp = client.post("/api/pronunciation?text=", content=b"\x00\x01")
    assert resp.status_code == 400


def test_pronunciation_empty_audio():
    resp = client.post("/api/pronunciation?text=hi", content=b"")
    assert resp.status_code == 400


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
