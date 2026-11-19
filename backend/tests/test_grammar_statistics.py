from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import db as database
from app.main import app
from app.models.session import PracticeSession


def learner(name):
    return TestClient(app, headers={"X-Client-Id": f"grammar-stats-{name}"})


def save(client, turns):
    messages = [{"role": "assistant", "content": "What happened?"}]
    corrections = []
    for line, edits in turns:
        index = len(messages)
        messages.append({"role": "user", "content": line})
        corrections.extend({"turn_index": index, "category": category, "original": before,
                            "suggestion": after, "note": "练习这处改动。"} for category, before, after in edits)
    response = client.post("/api/sessions", json={"scenario_id": "friend", "overall": 75,
                            "messages": messages, "corrections": corrections})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def report(client):
    response = client.get("/api/progress/grammar")
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def test_ranks_all_observed_types_by_distinct_occurrences_and_returns_the_learners_own_examples():
    client = learner("ranked")
    sentence = "I need ticket and map."
    session = save(client, [
        (sentence, [("articles", "ticket", "a ticket"),
                    ("articles", sentence, "I need a ticket and a map."),
                    ("word_choice", "ticket", "a ticket")]),
        ("Yesterday I go home and buy milk.", [("tense", "go", "went"), ("tense", "buy", "bought"),
         ("tense", "I go home and buy milk", "I went home and bought milk")]),
        ("We work here since May.", [("tense", "work", "have worked")]),
        ("I like the cats.", [("articles", "the cats", "cats")]),
        ("I need a umbrella.", [("articles", "a umbrella", "an umbrella")]),
        ("She take the bus.", [("agreement", "take", "takes")]),
        ("We should do a reservation.", [("word_choice", "do a reservation", "make a reservation")]),
        ("Let's discuss about the trip.", [("sentence_structure", "discuss about the trip", "discuss the trip")]),
        ("I work in Monday.", [("prepositions", "in Monday", "on Monday")]),
        ("Could you tell me where is the desk?", [("word_order", "where is the desk", "where the desk is")]),
    ])
    save(client, [("Could I borrow pencil?", [("articles", "pencil", "a pencil")])])

    stats = report(client)
    assert (stats["sessions_analyzed"], stats["session_limit"]) == (2, 50)
    groups = stats["groups"]
    assert [group["occurrences"] for group in groups] == sorted(
        (group["occurrences"] for group in groups), reverse=True)
    assert {group["kind"]: (group["occurrences"], group["sentences"]) for group in groups} == {
        "article_missing": (3, 2), "past_simple": (2, 1), "present_perfect": (1, 1),
        "article_extra": (1, 1), "article_choice": (1, 1), "agreement": (1, 1),
        "verb_object_collocation": (1, 1), "verb_object_structure": (1, 1),
        "time_preposition": (1, 1), "embedded_question": (1, 1),
    }
    missing = groups[0]
    assert missing["kind"] == "article_missing"
    example = next(example for example in missing["examples"] if example["session_id"] == session)
    assert (example["turn_index"], example["scenario_id"], example["original"],
            example["previous_partner_message"]) == (1, "friend", sentence, "What happened?")
    assert example["corrections"][0]["original"] == "ticket"
    assert example["corrections"][0]["suggestion"] == "a ticket"
    assert all(group["examples"] for group in groups)


def test_keeps_ambiguous_rewrites_broad_and_uses_the_complete_learner_sentence_for_tense():
    client = learner("context")
    save(client, [
        ("I had send the report.", [("tense", "send", "sent")]),
        ("We have send the report.", [("tense", "send", "sent")]),
        ("We worked here since June.", [("tense", "worked", "have worked")]),
        ("I have seen them yesterday.", [("tense", "have seen", "saw")]),
        ("I had a big meal.", [("word_choice", "big meal", "large meal")]),
        ("I asked someone.", [("articles", "I asked someone", "I called a mechanic")]),
        ("I need advice.", [("agreement", "advice", "Advice")]),
    ])
    groups = {group["kind"]: group for group in report(client)["groups"]}
    assert {kind: group["occurrences"] for kind, group in groups.items()} == {
        "tense": 1, "present_perfect": 3, "word_choice": 1, "articles": 1,
    }
    assert groups["tense"]["examples"][0]["original"] == "I had send the report."


def test_rejects_unmatched_legacy_evidence_and_does_not_count_self_marks_or_assistant_turns():
    client = learner("grounding")
    save_id = save(client, [("I need ticket. Can I get ticket here?", [])])
    with Session(database.engine) as db:
        session = db.get(PracticeSession, save_id)
        fix = {"turn_index": 1, "category": "articles", "original": "ticket",
               "suggestion": "a ticket", "note": "加冠词"}
        session.corrections = [fix, {**fix, "marked": True},
            {**fix, "original": "get ticket here", "suggestion": "get a ticket here"},
            {**fix, "original": "I need ticket. Can I get ticket here?", "self_marked": True},
            {**fix, "turn_index": 0, "original": "What", "suggestion": "The what"},
            {**fix, "turn_index": 2}, {**fix, "turn_index": 2**70}, {**fix, "original": "fake", "suggestion": "a fake"},
            {**fix, "original": "get", "suggestion": "", "turn_index": 2}, None]
        db.commit()
    stats = report(client)
    assert [(group["kind"], group["occurrences"]) for group in stats["groups"]] == [("article_missing", 1)]
    example = stats["groups"][0]["examples"][0]
    assert example["corrections"][0]["original"] == "get ticket here"
    assert report(learner("stranger"))["groups"] == []


def test_keeps_a_saved_article_deletion_through_scoring_and_retries():
    client = learner("saved-deletion")
    correction = {"turn_index": 1, "category": "articles", "original": "the", "suggestion": "",
                  "note": "这里泛指不需要冠词。", "marked": True, "self_marked": False}
    line = "I like the cats."
    draft = {"scenario_id": "friend", "client_session_id": "unscored-article-deletion", "overall": None,
             "messages": [{"role": "assistant", "content": "What do you like?"}, {"role": "user", "content": line}],
             "corrections": [correction]}
    saved = client.post("/api/sessions", json=draft)
    assert saved.status_code == 201
    session_id = saved.json()["id"]
    assert saved.json()["overall"] is None
    detail = client.get(f"/api/sessions/{session_id}")
    assert detail.status_code == 200
    assert detail.json()["corrections"] == [correction]

    before = report(client)
    assert before["sessions_analyzed"] == 1
    group, = before["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("article_extra", 1, 1)
    example, = group["examples"]
    assert (example["original"], example["corrections"]) == (line, [correction])

    score = {**draft, "overall": 75, "corrections": []}
    for payload in (score, {**score, "corrections": [correction]}, draft):
        retry = client.post("/api/sessions", json=payload)
        assert retry.status_code == 201
        assert (retry.json()["id"], retry.json()["overall"]) == (session_id, 75)
        assert retry.json()["corrections"] == [correction]
        assert report(client) == before


def test_deleting_a_whole_noun_phrase_does_not_infer_that_its_noun_was_retained():
    client = learner("phrase-deletion")
    save(client, [("I like the cats.", [("articles", "the cats", "")])])
    group, = report(client)["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("articles", 1, 1)
    focus, = group["examples"][0]["corrections"]
    assert (focus["original"], focus["suggestion"]) == ("the cats", "")


def test_counts_distinct_sentences_in_one_turn_including_the_unpunctuated_last_sentence():
    client = learner("multi-sentence")
    line = 'He asked, "Can I get ticket?" I need map. I left umbrella'
    save(client, [(line, [("articles", "ticket", "a ticket"), ("articles", "map", "a map"),
                         ("articles", "umbrella", "an umbrella")])])
    group, = report(client)["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("article_missing", 3, 3)
    assert {example["corrections"][0]["original"] for example in group["examples"]} == {"ticket", "map", "umbrella"}
    assert all(example["original"] == line and example["turn_index"] == 1 for example in group["examples"])


def test_counts_two_edits_in_one_sentence_without_splitting_titles_decimals_or_clock_abbreviations():
    client = learner("sentence-boundaries")
    line = "I need ticket for Mr. Lane to travel 3.5 miles at 3 p.m. and I need map."
    save(client, [(line, [("articles", "ticket", "a ticket"), ("articles", "map", "a map")])])
    group, = report(client)["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("article_missing", 2, 1)
    assert len(group["examples"]) == 1


def test_no_at_the_end_of_an_answer_is_not_a_number_abbreviation():
    client = learner("no-ending")
    line = "I needed ticket, but Helen said no. I need map."
    save(client, [(line, [("articles", "ticket", "a ticket"), ("articles", "map", "a map")])])
    group, = report(client)["groups"]
    assert (group["occurrences"], group["sentences"]) == (2, 2)


def test_keeps_an_independent_preposition_edit_from_an_overlapping_full_turn_correction():
    client = learner("overlapping-prepositions")
    line = "I was born on China. I grew up at Beijing."
    corrected = "I was born in China. I grew up in Beijing."
    save(client, [(line, [("prepositions", "on China", "in China"), ("prepositions", line, corrected)])])
    group, = report(client)["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("prepositions", 2, 2)
    examples = {example["corrections"][0]["original"]: example for example in group["examples"]}
    assert set(examples) == {"on China", "at"}
    assert examples["at"]["original"] == line
    assert examples["at"]["corrections"][0]["suggestion"] == "in"
    assert any(fix["original"] == line and fix["suggestion"] == corrected for fix in examples["at"]["corrections"])


def test_preserves_the_sentence_location_of_a_repeated_fragment_narrowed_from_the_full_turn():
    client = learner("anchored-repeat")
    line = "I need ticket. Can I get ticket here?"
    corrected = "I need a ticket. Can I get a ticket here?"
    save(client, [(line, [("articles", "need ticket", "need a ticket"), ("articles", line, corrected)])])
    group, = report(client)["groups"]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("article_missing", 2, 2)
    examples = {example["corrections"][0]["original"]: example for example in group["examples"]}
    assert set(examples) == {"need ticket", "ticket here"}
    sample = examples["ticket here"]
    assert sample["original"] == line
    assert sample["corrections"][0]["suggestion"] == "a ticket here"
    assert any(fix["original"] == line and fix["suggestion"] == corrected for fix in sample["corrections"])


def test_applies_the_window_before_filtering_sessions_and_counts_past_the_example_limit():
    client = learner("window")
    first = save(client, [("I need umbrella.", [("articles", "umbrella", "an umbrella")])])
    with Session(database.engine) as db:
        owner = db.get(PracticeSession, first).client_id
        db.add_all(PracticeSession(client_id=owner, scenario_id="friend", corrections=[]) for _ in range(44))
        db.commit()
    for _ in range(7):
        save(client, [("I go home yesterday.", [("tense", "go", "went")])])

    stats = report(client)
    assert stats["sessions_analyzed"] == 50
    assert len(stats["groups"]) == 1
    group = stats["groups"][0]
    assert (group["kind"], group["occurrences"], group["sentences"]) == ("past_simple", 7, 7)
    assert len(group["examples"]) == stats["example_limit"] == 5
    assert len({example["session_id"] for example in group["examples"]}) == 5


def test_each_type_gets_its_own_practice_edit_when_the_report_corrected_several_words():
    client = learner("mixed-fixes")
    articles = "I like the cats and I need a umbrella."
    fixed_articles = "I like cats and I need an umbrella."
    tenses = "Yesterday I go home. I work here since June."
    fixed_tenses = "Yesterday I went home. I have worked here since June."
    save(client, [(articles, [("articles", articles, fixed_articles)]),
                  (tenses, [("tense", tenses, fixed_tenses)])])
    stats = report(client)
    focused = {group["kind"]: group["examples"][0] for group in stats["groups"]}
    assert set(focused) == {"article_extra", "article_choice", "past_simple", "present_perfect"}
    for kind, before, after, source, reference in [
        ("article_extra", "the cats", "cats", articles, fixed_articles),
        ("article_choice", "a umbrella", "an umbrella", articles, fixed_articles),
        ("past_simple", "go", "went", tenses, fixed_tenses),
        ("present_perfect", "work", "have worked", tenses, fixed_tenses),
    ]:
        example = focused[kind]
        assert example["original"] == source
        focus, saved = example["corrections"]
        assert (focus["original"], focus["suggestion"]) == (before, after)
        assert (saved["original"], saved["suggestion"]) == (source, reference)


def test_counts_an_independent_word_edit_alongside_an_overlapping_collocation_fix():
    client = learner("residual")
    line = "I do a reservation for a big meal."
    whole = line.replace("do a", "make a").replace("big", "large")
    save(client, [(line, [("word_choice", "do a reservation", "make a reservation"), ("word_choice", line, whole)])])
    groups = {group["kind"]: group for group in report(client)["groups"]}
    assert {kind: group["occurrences"] for kind, group in groups.items()} == {"verb_object_collocation": 1, "word_choice": 1}
    focus = groups["word_choice"]["examples"][0]["corrections"][0]
    assert (focus["original"], focus["suggestion"]) == ("big", "large")


def test_does_not_label_a_modal_perfect_as_present_perfect_or_a_place_as_a_time():
    client = learner("ambiguous-subtypes")
    save(client, [
        ("I should go already.", [("tense", "go", "have gone")]),
        ("I could finished earlier.", [("tense", "finished", "have finished")]),
        ("I want to leave yesterday.", [("tense", "leave", "have left")]),
        ("The bus stops in two stations.", [("prepositions", "in two stations", "at two stations")]),
    ])
    groups = report(client)["groups"]
    assert {group["kind"]: group["occurrences"] for group in groups} == {"tense": 3, "prepositions": 1}


def test_counts_overlapping_alternative_rewrites_once_and_preserves_the_full_reference():
    client = learner("overlapping-wording")
    line = "I arrived at school."
    save(client, [(line, [("word_choice", "arrived", "got"), ("word_choice", "arrived at", "got to")])])
    group, = report(client)["groups"]
    example, = group["examples"]
    assert (group["kind"], group["occurrences"]) == ("word_choice", 1)
    assert any(fix["suggestion"] == "got to" for fix in example["corrections"])


def test_fuzzy_article_anchor_still_targets_the_selected_missing_article_in_a_multi_edit_fix():
    client = learner("article-spelling")
    line = "I have a apple and I need umberlla."
    save(client, [(line, [("articles", line, "I have an apple and I need an umbrella.")])])
    groups = {group["kind"]: group for group in report(client)["groups"]}
    fix = groups["article_missing"]["examples"][0]["corrections"][0]
    assert (fix["original"], fix["suggestion"]) == ("umberlla", "an umbrella")


def test_keeps_an_unclassified_verb_edit_alongside_a_supported_past_tense_and_ignores_unedited_embedded_questions():
    client = learner("separate-contexts")
    tense = "I go there yesterday. I could finished early."
    order = "Where is Ben? I know where he is. Coffee black please."
    save(client, [(tense, [("tense", tense, "I went there yesterday. I could have finished early.")]),
                  (order, [("word_order", order, "Where is Ben? I know where he is. Black coffee please.")])])
    groups = report(client)["groups"]
    assert {group["kind"]: group["occurrences"] for group in groups} == {"tense": 1, "past_simple": 1, "word_order": 1}


def test_structure_drills_focus_on_the_changed_clause_inside_a_larger_sentence():
    client = learner("structural-focus")
    question = "I has time. Could you tell me where is the station?"
    reason = "We discuss about the trip because was nervous."
    save(client, [(question, [("word_order", question, "I have time. Could you tell me where the station is?")]),
                  (reason, [("sentence_structure", reason, "We discuss the trip because I was nervous.")])])
    groups = {group["kind"]: group for group in report(client)["groups"]}
    assert set(groups) == {"embedded_question", "reason", "verb_object_structure"}
    for kind, before, after in [
        ("embedded_question", "is the station", "the station is"),
        ("reason", "was", "I was"),
        ("verb_object_structure", "discuss about", "discuss"),
    ]:
        focus = groups[kind]["examples"][0]["corrections"][0]
        assert (focus["original"], focus["suggestion"]) == (before, after)


def test_recovers_only_unique_learner_turns_for_old_corrections_without_an_index():
    client = learner("legacy-match")
    sid = save(client, [("I need   map today.", []), ("I need tea.", []), ("The border is open.", [])])
    with Session(database.engine) as db:
        row = db.get(PracticeSession, sid)
        fix = {"category": "articles", "original": "need map", "suggestion": "need a map", "note": "漏了冠词。"}
        row.corrections = [fix, {**fix, "original": "map", "suggestion": "a map", "turn_index": 1},
            {**fix, "category": "tense", "original": "need", "suggestion": "needed"},
            {**fix, "original": "order", "suggestion": "an order"},
            {**fix, "original": "What happened?", "suggestion": "What has happened?"},
            {**fix, "category": "word_choice", "original": "open", "suggestion": "accessible"},
            {**fix, "original": "tea", "suggestion": "some tea", "turn_index": 0}]
        db.commit()
    groups = {group["kind"]: group for group in report(client)["groups"]}
    assert {kind: group["occurrences"] for kind, group in groups.items()} == {"article_missing": 1, "word_choice": 1}
    sample = groups["word_choice"]["examples"][0]
    assert (sample["original"], sample["turn_index"], sample["corrections"][0]["turn_index"]) == ("The border is open.", 3, 3)
    articles = groups["article_missing"]["examples"][0]
    assert any(fix["original"] == "need map" and fix["turn_index"] == 1 for fix in articles["corrections"])
