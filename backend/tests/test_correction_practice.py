import json

import pytest
from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.core.config import get_settings
from app.main import app


client = TestClient(app)
exercise = {
    "original": "I go home with umbrella yesterday.",
    "reference": "I went home with an umbrella yesterday.",
    "focus": {"original": "go", "suggestion": "went", "category": "tense"},
    "previous_partner_message": "What happened yesterday?",
}
chinese = "我昨天带着一把伞回家了。"
clear = {"meaning_preserved": True, "focus_is_clear": True}


class Coach:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.prompts = []

    async def chat(self, messages, **kwargs):
        self.prompts.append(json.loads(messages[1]["content"]))
        return json.dumps(self.answers[0] if len(self.answers) == 1 else self.answers.pop(0))


def test_translation_uses_the_corrected_utterance_and_returns_only_the_chinese(monkeypatch):
    coach = Coach({"chinese": chinese, "reference": exercise["reference"]}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json=exercise)
    assert result.status_code == 200
    assert result.json() == {"chinese": chinese}
    assert coach.prompts[0]["reference"] == exercise["reference"]
    assert coach.prompts[0]["previous_partner_message"] == "What happened yesterday?"
    assert coach.prompts[1]["chinese"] == chinese
    assert coach.prompts[1]["focus"] == exercise["focus"]


def test_generation_rejects_an_untranslated_or_bilingual_answer_and_can_recover(monkeypatch):
    coach = Coach({"chinese": chinese + " " + exercise["reference"]}, {"chinese": chinese}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    assert client.post("/api/correction-practice/translation", json=exercise).json() == {"chinese": chinese}
    coach.answers = [{"chinese": "I went home with an umbrella yesterday."}]
    assert client.post("/api/correction-practice/translation", json=exercise).status_code == 503


@pytest.mark.parametrize(("attempt", "meaning", "focus", "natural", "passed"), [
    ("Yesterday I returned home with an umbrella.", True, True, True, True),
    ("I returned home yesterday.", False, True, True, False),
    ("I would go home with an umbrella yesterday.", True, False, True, False),
    ("Yesterday umbrella I my took home with.", True, True, False, False),
])
def test_grades_the_meaning_and_selected_change_independently(monkeypatch, attempt, meaning, focus, natural, passed):
    coach = Coach({"meaning_preserved": meaning, "focus_correct": focus, "natural": natural,
                   "feedback": "检查了带伞回家这件事和它发生的时间。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/check", json={**exercise, "chinese": chinese, "attempt": attempt})
    assert result.status_code == 200
    assert result.json()["correct"] is passed
    assert coach.prompts[0]["focus"] == exercise["focus"]
    assert coach.prompts[0]["chinese"] == chinese and coach.prompts[0]["attempt"] == attempt


def test_an_exact_reference_passes_and_repeating_the_recorded_mistake_fails_without_model_grading(monkeypatch):
    coach = Coach()
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    for attempt, correct in [(exercise["reference"].upper(), True), (exercise["original"], False),
                             ("I go home with an umbrella yesterday.", False)]:
        result = client.post("/api/correction-practice/check", json={**exercise, "chinese": chinese, "attempt": attempt})
        assert result.status_code == 200
        assert result.json()["correct"] is correct
    assert not coach.prompts


@pytest.mark.parametrize(("article", "correct", "feedback"), [
    ("a", False, "这里指的是特定对象，试着用定冠词。"),
    ("the", True, "原意和这处用法都说对了。"),
])
def test_short_article_grading_only_comments_on_the_selected_article(monkeypatch, article, correct, feedback):
    coach = Coach({"meaning_preserved": True, "focus_correct": False, "natural": True,
                   "feedback": "那只狗要用定冠词 the，park 前也应有 the。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/check", json={
        "original": "I saw a dog then went to park.",
        "reference": "I saw the dog then went to the park.",
        "previous_partner_message": "Did you see the dog?",
        "focus": {"original": "a", "suggestion": "the", "category": "articles"},
        "chinese": "我看见你说的那只狗了，然后去了公园。",
        "attempt": f"I saw {article} dog then went to the park.",
    })
    assert result.status_code == 200
    assert result.json() == {"correct": correct, "feedback": feedback}
    assert not coach.prompts


def test_incomplete_grades_and_whitespace_answers_never_pass(monkeypatch):
    coach = Coach({"natural": True, "focus_correct": True, "feedback": "不错。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    base = {**exercise, "chinese": chinese}
    assert client.post("/api/correction-practice/check", json={**base, "attempt": "   "}).status_code == 422
    assert client.post("/api/correction-practice/check", json={**base, "attempt": "I walked home."}).status_code == 503


def test_exact_match_keeps_currency_and_numbers_meaningful(monkeypatch):
    coach = Coach({"meaning_preserved": False, "focus_correct": True, "natural": True, "feedback": "货币单位变了。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {**exercise, "original": "I pay £15.", "reference": "I paid £15.", "chinese": "我付了十五英镑。",
            "focus": {"original": "pay", "suggestion": "paid", "category": "tense"}, "attempt": "I paid $15."}
    assert client.post("/api/correction-practice/check", json=body).json()["correct"] is False


@pytest.mark.parametrize("attempt", [
    "I will go home with an umbrella yesterday.",
    "I went home yesterday.",
    "I went home with an umbrella.",
])
def test_an_obvious_tense_change_or_dropped_detail_cannot_receive_a_perfect_grade(monkeypatch, attempt):
    coach = Coach({"meaning_preserved": True, "focus_correct": True, "natural": True, "feedback": "说得很好。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/check", json={**exercise, "chinese": chinese, "attempt": attempt})
    assert result.json()["correct"] is False


def test_generation_retries_a_grammar_note_in_place_of_the_utterance(monkeypatch):
    coach = Coach({"chinese": "这里要用过去式。"}, {"chinese": chinese}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    assert client.post("/api/correction-practice/translation", json=exercise).json() == {"chinese": chinese}


@pytest.mark.parametrize(("before", "after", "category", "reference"), [
    ("go", "went", "tense", "I went to the station."),
    ("gone", "have gone", "tense", "I have gone to the station."),
])
def test_generation_withholds_chinese_when_it_cannot_distinguish_the_target(
    monkeypatch, before, after, category, reference,
):
    ambiguous = "我去了车站。"
    coach = Coach({"chinese": ambiguous}, {**clear, "focus_is_clear": False})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {
        "original": reference.replace(after, before),
        "reference": reference,
        "focus": {"original": before, "suggestion": after, "category": category},
    }
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
    assert coach.prompts[1]["chinese"] == ambiguous


def test_generation_without_a_faithful_draft_is_distinct_from_a_transient_failure(monkeypatch):
    coach = Coach({"chinese": None}, {"chinese": chinese})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json=exercise)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
    assert len(coach.prompts) == 1


def test_generation_requires_a_structured_clarity_assessment(monkeypatch):
    coach = Coach({"chinese": chinese}, {**clear, "focus_is_clear": "true"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json=exercise)
    assert result.status_code == 503


def test_generation_does_not_add_an_unsupported_clue_to_force_the_target(monkeypatch):
    coach = Coach({"chinese": "我昨天去了车站。"}, {**clear, "meaning_preserved": False})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {
        "original": "I go to the station.",
        "reference": "I went to the station.",
        "focus": {"original": "go", "suggestion": "went", "category": "tense"},
    }
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"


@pytest.mark.parametrize(("partner", "expected"), [
    ("", 422),
    ("What did you do?", 422),
    ("Where did you go yesterday?", 200),
    ("What did you do last night?", 200),
])
def test_draft_cannot_invent_a_day_even_if_the_review_would_approve(monkeypatch, partner, expected):
    chinese = "我昨天去了车站。"
    coach = Coach({"chinese": chinese}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I go to the station.",
        "reference": "I went to the station.",
        "previous_partner_message": partner,
        "focus": {"original": "go", "suggestion": "went", "category": "tense"},
    })
    assert result.status_code == expected
    if expected == 422:
        assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
        assert len(coach.prompts) == 1
    else:
        assert result.json() == {"chinese": chinese}
        assert len(coach.prompts) == 2


@pytest.mark.parametrize(("original", "reference", "before", "after", "partner"), [
    ("I saw dog.", "I saw the dog.", "dog", "the dog", ""),
    ("I saw a dog.", "I saw the dog.", "a", "the", "What did you see?"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "Did you see a dog or a cat?"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "The dog owner was looking for you."),
    ("I saw brown dog.", "I saw the brown dog.", "brown", "the brown", "Did you see the brown cat?"),
    ("I saw brown dog.", "I saw the brown dog.", "brown", "the brown", "Did you see the black dog?"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "I want to adopt a dog."),
    *[
        ("I saw dog.", "I saw the dog.", "dog", "the dog", partner)
        for partner in (
            "I did not see a dog.",
            "I don't have a dog.",
            "I didn’t see a dog.",
            "The animal isn't a dog.",
            "I haven't seen a dog.",
            "I won't adopt a dog.",
            "I cannot see a dog.",
            "I saw a dog or a cat.",
            "I saw a cat, or maybe a dog.",
            "I saw a dog by the gate or a cat.",
            "I saw a picture of a dog.",
            "I saw a photo of the dog.",
        )
    ],
    *[
        ("I saw cat.", "I saw the cat.", "cat", "the cat", partner)
        for partner in (
            "Maybe I saw a cat.",
            "I saw a dog, maybe a cat.",
            "I saw a dog, perhaps a cat.",
            "I saw a dog, possibly a cat.",
            "I saw a cat, maybe.",
            "I saw a cat, perhaps.",
            "I saw a cat, possibly.",
            "I saw a cat in the park, maybe.",
            "Maybe I missed a dog because a cat was there.",
            "I didn't see a dog because maybe a cat was there.",
            "I didn't see a dog because a cat wasn't there.",
            "I didn't see a dog because a cat was not there.",
            "I didn't see a dog because a cat didn't exist.",
            "I didn't see a dog because a cat wasn’t present.",
            "I didn't see a dog because a cat wasn't anywhere.",
            "I didn't see a dog because a cat wasn't actually there.",
            "I didn't see a dog because a cat wasn't in the room.",
            "I didn't see a dog because a cat was absent.",
            "I didn't see a dog because a cat was nowhere.",
            "I didn't see a dog because a cat didn't show up.",
            "I didn't see a dog because a cat was missing.",
            "I didn't see a dog because a cat was gone.",
            "I didn't see a dog because a cat wasn't home.",
            "I didn't see a dog because a cat didn't turn up.",
            "I didn't see a dog because a cat wasn't to be found.",
            "I didn't see a dog because a cat was not in attendance.",
            "I didn't see a dog because a cat failed to appear.",
        )
    ],
    ("I saw dog in a park.", "I saw the dog in a park.", "dog", "the dog", ""),
    ("I saw dog in the park.", "I saw the dog in the park.", "dog", "the dog", ""),
    ("I saw dog in the park.", "I saw the dog in the park.", "dog", "the dog", "The dog by the car?"),
    ("I saw dog in the park.", "I saw the dog in the park.", "dog", "the dog", "I saw a dog by the car."),
    ("I saw the dog in the park.", "I saw the dog in the park.", "the dog", "the dog", "The dog in the park?"),
    ("I saw the dog in the park.", "I saw the dog in the park.", "dog", "the dog", "The dog in the park?"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "The dog by the gate or the dog by the car?"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "A dog was outside. Another dog was by the gate."),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "It was cute. I saw it again."),
    ("I saw a dog and a cat.", "I saw the dog and the cat.", "a", "the", "Did you see the dog?"),
    ("I went to station.", "I went to the station.", "station", "the station", "Did you visit the hotel?"),
])
def test_ungrounded_definite_article_falls_back_to_cloze_before_asking_deepseek(
    monkeypatch, original, reference, before, after, partner,
):
    coach = Coach({"chinese": "我看见那只狗了。"}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {"original": original, "reference": reference, "previous_partner_message": partner,
            "focus": {"original": before, "suggestion": after, "category": "articles"}}
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
    assert not coach.prompts


@pytest.mark.parametrize(("original", "reference", "before", "after", "partner", "prompt"), [
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "Did you see the brown dog by the gate?", "我看见门边那只棕色的狗了。"),
    ("I saw a dog.", "I saw the dog.", "a", "the", "Did you see the dog?", "我看见你说的那只狗了。"),
    ("I went to station.", "I went to the station.", "station", "the station",
     "Did you find the train station near the hotel?", "我去了酒店附近的那个车站。"),
    ("I saw dog we adopted.", "I saw the dog we adopted.", "dog", "the dog", "", "我看见我们领养的那只狗了。"),
    ("I saw dog by the entrance.", "I saw the dog by the entrance.", "dog", "the dog", "", "我看见入口旁的那只狗了。"),
    ("I saw dog at the entrance.", "I saw the dog at the entrance.", "dog", "the dog", "", "我看见入口处那只狗了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "I saw a dog. Did you see the dog?", "我也看见那只狗了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "Look at the dog! The dog is cute.", "我看见那只狗了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "I saw a dog. The dog was cute.", "我看见那只狗了。"),
    ("I saw dog in the park.", "I saw the dog in the park.", "dog", "the dog",
     "The dog by the car? Or the dog in the park?", "我看见公园里的那只狗了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "I didn't see a cat. I saw a dog.", "我看见那只狗了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat", "I saw a cat.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I saw a cat, and maybe a dog.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I didn't see a dog because a cat was there.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I didn't see a dog because a cat wasn't happy.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I didn't see a dog because a cat wasn't in the mood.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I didn't see a dog because a cat was missing an ear.", "我看见那只猫了。"),
    ("I saw cat.", "I saw the cat.", "cat", "the cat",
     "I didn't see a dog because a cat didn't like the noise.", "我看见那只猫了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog", "I didn't see the dog.", "我看见那只狗了。"),
    ("I saw dog.", "I saw the dog.", "dog", "the dog",
     "I saw a dog. I saw a picture of a dog.", "我看见那只狗了。"),
    ("I saw a dog and a cat.", "I saw the dog and the cat.", "a dog", "the dog",
     "Did you see the dog and the cat?", "我看见那只狗和那只猫了。"),
    ("I saw dog in front of the hotel.", "I saw the dog in front of the hotel.", "dog", "the dog", "",
     "我看见酒店前面的那只狗了。"),
    ("I saw dog next to the gate.", "I saw the dog next to the gate.", "dog", "the dog", "",
     "我看见大门旁的那只狗了。"),
    ("I saw dog across from the hotel.", "I saw the dog across from the hotel.", "dog", "the dog", "",
     "我看见酒店对面的那只狗了。"),
    ("I saw dog over there.", "I saw the dog over there.", "dog", "the dog", "", "我看见那边那只狗了。"),
    ("I saw a dog near the park.", "I saw the dog near the park.", "a", "the",
     "Did you see the brown dog by the gate?", "我看见公园附近的那只狗了。"),
    ("I fed a dog near the park.", "I fed the dog near the park.", "a", "the",
     "Did you see the dog?", "我喂了公园附近的那只狗。"),
    ("I saw a dog then went to park.", "I saw the dog then went to the park.", "a", "the",
     "Did you see the dog?", "我看见那只狗后就去了公园。"),
    ("I saw a dog. Dog barked.", "I saw a dog. The dog barked.", "Dog", "The dog", "", "我看见一只狗，那只狗叫了。"),
    ("I saw sun.", "I saw the sun.", "sun", "the sun", "", "我看见太阳了。"),
    ("I saw movie.", "I saw a movie.", "movie", "a movie", "", "我看了一部电影。"),
])
def test_grounded_or_indefinite_article_remains_eligible_for_translation(
    monkeypatch, original, reference, before, after, partner, prompt,
):
    coach = Coach({"chinese": prompt}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {"original": original, "reference": reference, "previous_partner_message": partner,
            "focus": {"original": before, "suggestion": after, "category": "articles"}}
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 200
    assert result.json() == {"chinese": prompt}
    assert len(coach.prompts) == 2


@pytest.mark.parametrize("source", ["local_referent", "model_draft", "model_review"])
def test_translation_fallback_records_its_source_without_changing_the_response(monkeypatch, source):
    class Sink:
        records = []

        def submit(self, record):
            self.records.append(record)

    sink = Sink()
    monkeypatch.setattr(get_settings(), "telemetry_enabled", True)
    monkeypatch.setattr(app.state, "telemetry_sink", sink, raising=False)
    body = exercise
    if source == "local_referent":
        body = {"original": "I saw dog.", "reference": "I saw the dog.",
                "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"}}
    drafts = {"model_draft": ({"chinese": None},),
              "model_review": ({"chinese": chinese}, {**clear, "focus_is_clear": False})}
    coach = Coach(*drafts.get(source, ({"chinese": "我看见那只狗了。"}, clear)))
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
    record, = sink.records
    assert record["operation"] == "POST /api/correction-practice/translation"
    assert record["http_status"] == 422
    assert (record["error_type"], record["error_cause_type"]) == ("AmbiguousTranslationPrompt", source)


def test_retries_a_grounded_article_draft_that_loses_the_distinguishing_position(monkeypatch):
    coach = Coach(
        {"chinese": "我在酒店前面看见一只狗。"}, {**clear, "focus_is_clear": False},
        {"chinese": "我看到酒店前面的那只狗了。"}, clear,
    )
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    body = {
        "original": "I saw dog in front of the hotel.",
        "reference": "I saw the dog in front of the hotel.",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    }
    result = client.post("/api/correction-practice/translation", json=body)
    assert result.status_code == 200
    assert result.json() == {"chinese": "我看到酒店前面的那只狗了。"}
    assert len(coach.prompts) == 4


@pytest.mark.parametrize(("location", "corrected_prompt"), [
    ("in front of the hotel", "我看见了酒店门前的那只狗。"),
    ("next to the gate", "我看见了紧挨着大门的那只狗。"),
    ("across from the hotel", "我看见了酒店对面的那只狗。"),
    ("over there", "我看见了那儿的那只狗。"),
])
def test_retries_before_review_when_a_draft_omits_the_compound_location(monkeypatch, location, corrected_prompt):
    coach = Coach({"chinese": "我看见了那只狗。"}, {"chinese": corrected_prompt}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": f"I saw dog {location}.",
        "reference": f"I saw the dog {location}.",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == 200
    assert result.json() == {"chinese": corrected_prompt}
    assert len(coach.prompts) == 3
    assert "chinese" not in coach.prompts[1]


@pytest.mark.parametrize(("location", "prompt", "meaning_preserved", "expected"), [
    ("over there", "我看见了那边的那只狗。", True, 200),
    ("over there", "我看见了那边的那只狗。", False, 422),
    ("next to the gate", "我看见了大门旁边的那只狗。", True, 200),
    ("next to the gate", "我看见了那个大门旁边的狗。", True, 422),
])
def test_checks_a_visible_definite_cue_separately_from_meaning(monkeypatch, location, prompt, meaning_preserved, expected):
    judgment = {"meaning_preserved": meaning_preserved, "focus_is_clear": False}
    coach = Coach({"chinese": prompt}, judgment, {"chinese": prompt}, judgment)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": f"I saw dog {location}.",
        "reference": f"I saw the dog {location}.",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == expected
    assert len(coach.prompts) == (2 if expected == 200 else 3)


@pytest.mark.parametrize(("draft", "meaning_preserved", "expected"), [
    ("我看见了公园里的那只狗。", True, 200),
    ("我看见了公园里那只狗。", True, 200),
    ("我看见了公园里的那只狗。", False, 422),
])
def test_matching_location_reuses_the_partner_referent_but_preserves_meaning(
    monkeypatch, draft, meaning_preserved, expected,
):
    review = {"meaning_preserved": meaning_preserved, "focus_is_clear": False}
    coach = Coach({"chinese": draft}, review, {"chinese": draft}, review)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw dog in the park.",
        "reference": "I saw the dog in the park.",
        "previous_partner_message": "The dog in the park?",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == expected
    assert coach.prompts[0]["grounded_mention"] == "the dog in the park"
    assert coach.prompts[1]["grounded_mention"] == "the dog in the park"
    assert len(coach.prompts) == (2 if expected == 200 else 3)


@pytest.mark.parametrize("draft", [
    "我看见动物园里的那只狗。",
    "我看见那只狗。",
    "我看见公园里的那只猫。",
    "我看见了那个公园里的狗。",
])
def test_wrong_setting_or_object_is_rejected_even_if_review_would_approve(monkeypatch, draft):
    class FixedDraftCoach(Coach):
        async def chat(self, messages, **kwargs):
            payload = json.loads(messages[1]["content"])
            self.prompts.append(payload)
            return json.dumps(clear if "chinese" in payload else {"chinese": draft})

    coach = FixedDraftCoach()
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw dog in the park.",
        "reference": "I saw the dog in the park.",
        "previous_partner_message": "The dog in the park?",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "translation_prompt_ambiguous"
    assert len(coach.prompts) == 2
    assert all("chinese" not in payload for payload in coach.prompts)


def test_short_article_focus_survives_a_competitor_that_drops_its_demonstrative(monkeypatch):
    draft = "我看见那只狗，然后去了公园。"
    coach = Coach({"chinese": draft}, {
        "cue_evidence": "那只狗 preserves the dog mentioned by the partner.",
        "meaning_preserved": True,
        "competing_translation": "I saw a dog then went to the park.",
        "focus_is_clear": False,
    })
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw a dog then went to park.",
        "reference": "I saw the dog then went to the park.",
        "previous_partner_message": "Did you see the dog?",
        "focus": {"original": "a", "suggestion": "the", "category": "articles"},
    })
    assert result.status_code == 200
    assert result.json() == {"chinese": draft}
    assert len(coach.prompts) == 2
    assert all(payload["selected_article"] == "the dog" for payload in coach.prompts)


@pytest.mark.parametrize("competing", [
    "A dog in the park saw me.",
    "I didn't see a dog in the park.",
    "Did I see a dog in the park?",
    "I saw a dog across from the park.",
    "I saw the dog in a park.",
])
def test_visible_article_cannot_override_a_competitor_with_other_changes(monkeypatch, competing):
    draft = "我看见公园里的那只狗了。"
    coach = Coach({"chinese": draft}, {**clear, "competing_translation": competing},
                  {"chinese": draft}, clear)
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw dog in the park.", "reference": "I saw the dog in the park.",
        "previous_partner_message": "The dog in the park?",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == 422
    assert len(coach.prompts) == 3


@pytest.mark.parametrize("draft", [
    "公园里的那只狗看见了我。",
    "我没有看见公园里的那只狗。",
    "我看见了公园里的那只狗吗？",
    "公园里的那只狗我没能看到。",
    "公园里的那只狗我没能看见。",
    "公园里的那只狗我没法看见。",
    "我没能够看到公园里的那只狗。",
])
def test_grounded_article_rejects_an_obvious_meaning_change_before_review(monkeypatch, draft):
    coach = Coach({"chinese": draft})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw dog in the park.", "reference": "I saw the dog in the park.",
        "previous_partner_message": "The dog in the park?",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == 422
    assert len(coach.prompts) == 2
    assert all("chinese" not in payload for payload in coach.prompts)


def test_repeated_rejected_draft_is_not_reviewed_again(monkeypatch):
    draft = "我在公园里看见了那只狗。"
    coach = Coach(
        {"chinese": draft},
        {"cue_evidence": "The direction of the action was lost.", "meaning_preserved": False,
         "competing_translation": "", "focus_is_clear": False},
        {"chinese": draft},
        clear,
    )
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/translation", json={
        "original": "I saw dog in the park, then I went home.",
        "reference": "I saw the dog in the park, then I went home.",
        "previous_partner_message": "The dog in the park?",
        "focus": {"original": "dog", "suggestion": "the dog", "category": "articles"},
    })
    assert result.status_code == 422
    assert len(coach.prompts) == 3
    assert coach.prompts[2]["previous_review"]["cue_evidence"] == "The direction of the action was lost."


@pytest.mark.parametrize(("attempt", "passed"), [
    ("I went to that station.", True),
    ("I went to this station.", False),
    ("I went to a station.", False),
    ("I left that station.", False),
])
def test_accepts_an_exact_demonstrative_paraphrase_of_the_selected_definite_reference(monkeypatch, attempt, passed):
    coach = Coach({"meaning_preserved": True, "focus_correct": False, "natural": True, "feedback": "冠词不同。"})
    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: coach)
    result = client.post("/api/correction-practice/check", json={
        "original": "I went to station.",
        "reference": "I went to the station.",
        "focus": {"original": "station", "suggestion": "the station", "category": "articles"},
        "previous_partner_message": "Did you find the train station near the hotel?",
        "chinese": "我去了那个车站。",
        "attempt": attempt,
    })
    assert result.status_code == 200
    assert result.json()["correct"] is passed
    assert len(coach.prompts) == (0 if passed else 1)
