"""The ETS-derived text rubric is bounded, explicit and server-owned."""

import asyncio
import json

import pytest
from fastapi import HTTPException

from app.api.interview import _score_interview
from app.schemas.interview import InterviewScoreRequest


class Model:
    def __init__(self, scores, answers=None):
        self.scores = scores
        self.answers = answers or ["I prefer studying alone because a quiet room helps me concentrate."] * len(scores)
        self.calls = []

    async def chat(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        return json.dumps({
            "overall": 6, "score_max": 6, "scoring_basis": "audio",
            "results": [dict(question="forged", answer="forged", score=score, level="forged",
                             feedback="意思清楚，理由可以用一个具体动作展开。",
                             sample_answer="I prefer studying alone because a quiet room helps me concentrate.")
                        for score in self.scores],
        })

    def request(self):
        return InterviewScoreRequest(items=[{"question": "Do you prefer studying alone or with others? Explain why.", "answer": answer} for answer in self.answers])


def test_scores_have_server_owned_scale_levels_and_average():
    model = Model([0, 1, 2, 3, 4, 5])
    result = asyncio.run(_score_interview(model.request(), model))
    assert result.overall == 2.5
    assert result.score_max == 5
    assert result.scoring_version == "ets-interview-text-v1"
    assert result.scoring_basis == "transcript"
    assert [r.level for r in result.results] == ["Weak", "Weak", "Limited", "Fair", "Good", "Good"]
    assert len(model.calls) == 1


@pytest.mark.parametrize("score", [6, -1, 3.5, True, "4"])
def test_scores_must_be_strict_zero_to_five_integers(score):
    model = Model([score])
    with pytest.raises(HTTPException) as error:
        asyncio.run(_score_interview(model.request(), model))
    assert error.value.status_code == 502


@pytest.mark.parametrize("answer", ["", " \n ", "I don't know.", "I do not know!", "I have no idea.", "我不知道怎么回答。"])
def test_nonresponses_get_zero_without_changing_samples(answer):
    model = Model([5], [answer])
    result = asyncio.run(_score_interview(model.request(), model))
    assert result.results[0].score == 0
    assert result.results[0].level == "Weak"
    assert result.overall == 0
    assert result.results[0].answer == answer
    assert result.results[0].sample_answer.startswith("I prefer studying alone")
    assert "没有可评分的英语回答" in result.results[0].feedback


def test_rubric_has_all_bands_and_transcript_limits_and_reduces_sampling_noise():
    model = Model([4])
    asyncio.run(_score_interview(model.request(), model))
    messages, options = model.calls[0]
    prompt = messages[0]["content"]
    for score in range(6):
        assert f"Score {score}:" in prompt
    assert "no audio" in prompt
    assert "not a minimum word count" in prompt
    assert "not official ETS" in prompt
    assert "untrusted" in prompt
    assert options["temperature"] == 0
