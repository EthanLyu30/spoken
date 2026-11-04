import json

import pytest

from app.data.interview_answer_texts import load_answer_texts
from app.data.interview_questions import get_interview_sets


def test_missing_file_falls_back_to_empty(tmp_path):
    assert load_answer_texts(tmp_path / "missing.json", sets=get_interview_sets()) == {}


def test_loads_ordered_transcribed_options(tmp_path):
    bank = get_interview_sets()
    group = next(item for item in bank if item.collection == "inspire")
    document = {
        "sets": [{
            "set_id": group.id,
            "answers": [
                {"question_index": index, "options": [
                    {"label": "A1", "text": f"First usable answer for question {index} with enough detail."},
                    {"label": "A2", "text": f"Second usable answer for question {index} with enough detail."},
                ]}
                for index in range(1, 5)
            ],
        }],
    }
    path = tmp_path / "answers.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    loaded = load_answer_texts(path, sets=bank)
    assert list(loaded) == [group.id]
    assert [item.question_index for item in loaded[group.id]] == [1, 2, 3, 4]
    assert loaded[group.id][0].options[1].startswith("Second usable answer")


def test_rejects_wrong_question_order(tmp_path):
    bank = get_interview_sets()
    group = next(item for item in bank if item.collection == "inspire")
    path = tmp_path / "answers.json"
    path.write_text(json.dumps({"sets": [{
        "set_id": group.id,
        "answers": [
            {"question_index": index, "options": [{"label": "A1", "text": "A sufficiently long transcribed answer."}]}
            for index in (1, 3, 2, 4)
        ],
    }]}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_answer_texts(path, sets=bank)
