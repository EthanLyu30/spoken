import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import xf_tts


@pytest.mark.parametrize('path', ['/api/tts', '/api/tts/stream', '/api/tts/prepare'])
@pytest.mark.parametrize('body', [None, {'text': 'Hello', 'vcn': 'henry', 'warmup_ticket': 'a' * 32}])
def test_retired_tts_never_constructs_a_provider_or_opens_a_socket(monkeypatch, path, body):
    calls = []

    def forbidden(*args, **kwargs):
        calls.append(True)
        raise AssertionError('retired TTS must not perform provider work')

    monkeypatch.setattr(xf_tts.XfTtsClient, '__init__', forbidden)
    monkeypatch.setattr(xf_tts.websockets, 'connect', forbidden)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(path, **({'json': body} if body is not None else {}))
    assert response.status_code == 410
    assert response.headers['cache-control'] == 'no-store'
    assert '浏览器语音' in response.json()['detail']
    assert calls == []


def test_application_no_longer_owns_cloud_audio_preparations_or_cache():
    with TestClient(app):
        assert getattr(app.state, 'tts_warmup_pool', None) is None
        assert getattr(app.state, 'public_tts_cache', None) is None
