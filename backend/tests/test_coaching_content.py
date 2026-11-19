"""Exercise targets must survive a mistaken approval from the model."""

import json

import pytest
from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app


@pytest.mark.parametrize(("case", "category", "sentence", "before", "after", "valid", "off_target"), [
    ("past", "tense", "Yesterday I send the draft.", "send", "sent", (
        ("I ___ the slides before lunch.", "I sent the slides before lunch."),
        ("On Friday, I ___ a copy to the client.", "On Friday, I sent a copy to the client."),
    ), ("I'd like ___ to Oxford.", "I'd like a ticket to Oxford.")),
    ("perfect", "tense", "I work here since May.", "work", "have worked", (
        ("I ___ at the new branch since June.", "I have worked at the new branch since June."),
        ("I ___ in retail for six years.", "I have worked in retail for six years."),
    ), ("I ___ at the old branch last June.", "I worked at the old branch last June.")),
    ("perfect_auxiliary", "tense", "I have send the invite.", "send", "sent", (
        ("I ___ the reminder to the team.", "I have sent the reminder to the team."),
        ("We ___ a draft to our client.", "We have sent a draft to our client."),
    ), ("I ___ the file yesterday.", "I sent the file yesterday.")),
    ("missing_article", "articles", "I need umbrella.", "umbrella", "an umbrella", (
        ("Could I borrow ___?", "Could I borrow a flashlight?"),
        ("I'd also like ___, please.", "I'd also like an emergency blanket, please."),
    ), ("Could I borrow ___?", "Could I borrow your flashlight?")),
    ("sound", "articles", "I have an sore throat.", "an sore throat", "a sore throat", (
        ("I need ___ bandage.", "I need a bandage."),
        ("Could I get ___ ice pack?", "Could I get an ice pack?"),
    ), ("I need ___ bandage.", "I need an bandage.")),
    ("definite_article", "articles", "A key you gave me doesn't work.", "A key", "The key", (
        ("___ code you sent me has expired.", "The code you sent me has expired."),
        ("Could you check ___ receipt I just showed you?", "Could you check the receipt I just showed you?"),
    ), ("Could you check ___ receipt?", "Could you check a receipt?")),
    ("extra_article", "articles", "I read the reviews before booking hotels.", "the reviews", "reviews", (
        ("I usually look at ___ first.", "I usually look at photos first."),
        ("I often check ___ on different sites.", "I often check prices on different sites."),
    ), ("I usually look at ___ first.", "I usually look at the photos first.")),
    ("agreement", "agreement", "She work weekends.", "work", "works", (
        ("He ___ at the front desk.", "He works at the front desk."),
        ("My colleague ___ on Sundays.", "My colleague works on Sundays."),
    ), ("They ___ mornings.", "They work mornings.")),
    ("agreement_revealed", "agreement", "She work weekends.", "work", "works", (
        ("He ___ at the front desk.", "He works at the front desk."),
        ("My colleague ___ on Sundays.", "My colleague works on Sundays."),
    ), ("He ___ at the front desk.", "He works at the front desk.")),
    ("word_order", "word_order", "Could you tell me where is the station?", "where is the station", "where the station is", (
        ("Could you tell me where ___?", "Could you tell me where the lockers are?"),
        ("Do you know where ___?", "Do you know where the ticket office is?"),
    ), ("Could you tell me where ___?", "Could you tell me where are the lockers?")),
    ("word_order_tutor", "word_order", "Could you tell me where is the station?", "where is the station", "where the station is", (
        ("Could you tell me where ___?", "Could you tell me where the lockers are?"),
        ("Do you know where ___?", "Do you know where the ticket office is?"),
    ), ("Could you tell me where ___?", "Could you tell me where the lockers are?")),
    ("word_order_server_hint", "word_order", "Could you tell me where is the station?", "where is the station", "where the station is", (
        ("Could you tell me where ___?", "Could you tell me where the lockers are?"),
        ("Do you know where ___?", "Do you know where the ticket office is?"),
    ), ("Could you tell me where ___?", "Could you tell me where are the lockers?")),
    ("sentence_structure", "sentence_structure", "I left because was tired.", "because was tired", "because I was tired", (
        ("I need to leave early because ___.", "I need to leave early because I am sick."),
        ("I called the desk because ___.", "I called the desk because the door was stuck."),
    ), ("I need to leave early because ___.", "I need to leave early because of a headache.")),
    ("preposition", "prepositions", "I can arrive in Monday.", "in Monday", "on Monday", (
        ("I can come ___ Thursday.", "I can come on Thursday."),
        ("Could we meet ___ Friday?", "Could we meet on Friday?"),
    ), ("I can come ___ Thursday.", "I can come in Thursday.")),
    ("word_choice", "word_choice", "I need to do a reservation for tonight.", "do a reservation", "make a reservation", (
        ("I'd like to ___ for three.", "I'd like to make a reservation for three."),
        ("Could we ___ for Saturday?", "Could we make a reservation for Saturday?"),
    ), ("I want to ___ for Saturday.", "I want to do a reservation for Saturday.")),
])
def test_plan_rejects_a_reference_that_does_not_practise_the_saved_edit(
    monkeypatch, coaching_review_json, case, category, sentence, before, after, valid, off_target,
):
    owner = TestClient(app, client=(f"coaching-content-{case}", 50000), headers={"X-Client-Id": f"coaching-content-{case}"})
    assert owner.post("/api/sessions", json={
        "scenario_id": "friend", "overall": 75, "messages": [{"role": "user", "content": sentence}],
        "corrections": [{"original": before, "suggestion": after, "note": "试试这个用法。", "category": category, "turn_index": 0}],
    }).status_code == 201
    revision = owner.get("/api/progress/coaching").json()["revision"]
    drafts, reviews = [], []

    def draft(first, question):
        return {"summary": "从自己的句子开始，试试同一种用法。", "evidence": [1], "scene": {
            "title": "A short conversation", "title_zh": "练习口语", "partner_role": "A friendly partner",
            "goal": "给出两个回答。", "persona": "You ask simple questions.", "opening_line": "Hi, how are you?",
            "practice_cues": [{"keyword": "Let me think", "meaning": "需要想一想时说", "sentence": "Let me think for a second."}],
            "practice_exercises": [
                {"partner_line": question,
                 "task": "先回答第一个问题。", "hint": first[0], "example": first[1]},
                {"partner_line": "Anything else?", "task": "再说另一件事。", "hint": valid[1][0], "example": valid[1][1]},
            ],
        }}

    class Coach:
        async def chat(self, messages, **kwargs):
            material = json.loads(messages[-1]["content"])
            if "lesson" in material:
                reviews.append(material)
                return coaching_review_json()
            drafts.append(material)
            question = {"agreement_revealed": "Who works at the front desk?",
                        "word_order_tutor": "Ask me politely where the lockers are."}.get(case, "What would you say first?")
            lesson = draft(off_target, question) if len(drafts) == 1 else draft(valid[0], "What would you say first?")
            if case == "word_order_server_hint":
                for exercise in lesson["scene"]["practice_exercises"]:
                    del exercise["hint"]
            raw = json.dumps(lesson, ensure_ascii=False)
            return raw[:-1] if case == "perfect_auxiliary" and len(drafts) == 2 else raw

    monkeypatch.setitem(app.dependency_overrides, get_client, Coach)
    result = owner.post("/api/progress/coaching/plan", params={"revision": revision})
    assert result.status_code == 200, result.text
    exercises = result.json()["scene"]["practice_exercises"]
    assert [exercise["example"] for exercise in exercises] == [example for _, example in valid]
    assert [exercise["hint"] for exercise in exercises] == [hint for hint, _ in valid]
    assert len(drafts) == 2
    assert len(reviews) == 1


@pytest.mark.parametrize(("case", "records", "role", "forms", "facts"), [
    ("museum", (
        ("friend", "I visit the art museum last week.", "visit", "visited", "tense"),
        ("hotel", "I finish my report before lunch.", "finish", "finished", "tense"),
    ), "colleague", ("visited", "finished"), (0, "Which exhibit", "蒸汽机展", "visited the steam engine exhibit")),
    ("shuttle", (
        ("friend", "I went home because was ill.", "because was ill", "because I was ill", "sentence_structure"),
        ("hotel", "I moved because was noisy.", "because was noisy", "because it was noisy", "sentence_structure"),
    ), "travel companion", ("", ""), (0, "Why did you take a taxi", "接驳车没来", "because the shuttle did not come")),
    ("bare-plural", (
        ("hotel", "I always look at the ratings first.", "the ratings", "ratings", "articles"),
        ("directions", "I prefer the trains on long trips.", "the trains", "trains", "articles"),
    ), "travel companion", ("", ""), (0, "What do you look at", "先看照片", "check photos")),
    ("agreement", (
        ("standup", "My manager handle complaints.", "handle", "handles", "agreement"),
        ("negotiation", "Our supplier deliver every week.", "deliver", "delivers", "agreement"),
    ), "colleague", ("handles", "delivers"), (0, "Who should I contact", "会计负责供应商发票", "accountant handles the supplier invoices")),
    ("directions", (
        ("airport", "Do you know where is the terminal?", "where is the terminal", "where the terminal is", "word_order"),
    ), "station information clerk", ("", ""), (0, "Are you looking for anything", "行李寄存柜在哪里", "where the luggage lockers are")),
    ("help-at-work", (
        ("standup", "Yesterday I send the slides.", "send", "sent", "tense"),
        ("interview", "I lead a workshop last week.", "lead", "led", "tense"),
    ), "colleague", ("sent", "led"), (1, "Did anyone help", "Maya 帮了你", "Yes, Maya helped me.")),
    ("original-box", (
        ("shopping", "A receipt you gave me is missing.", "A receipt", "The receipt", "articles"),
    ), "returns clerk", ("", ""), (1, "bought those headphones yesterday", "今早把原包装盒落在家里", "left the original box at home this morning")),
    ("book-a-room", (
        ("oneonone", "I can come in Monday.", "in Monday", "on Monday", "prepositions"),
    ), "colleague", ("on", "on"), (1, "Should we book", "同意订这间小会议室", "Yes, let's book it for the budget review on Thursday.")),
    ("check-in", (
        ("airport", "I need to check bag.", "bag", "a bag", "articles"),
    ), "check-in agent", ("", ""), (1, "Where would you like to sit", "靠过道的座位", "an aisle seat")),
    ("duration", (
        ("interview", "I work here since April.", "work", "have worked", "tense"),
        ("networking", "I live here for three years.", "live", "have lived", "tense"),
    ), "attendee", ("worked", "lived"), (1, "How long has this city been home", "在这座城市住了五年", "have lived here for five years")),
    ("article-sounds", (
        ("hotel", "I'd like a extra blanket.", "a extra blanket", "an extra blanket", "articles"),
    ), "front desk clerk", ("", ""), (1, "charge your devices", "借一个转换插头", "an adapter to charge my phone")),
    ("table-reservation", (
        ("restaurant", "I'd like to do a reservation for tomorrow.", "do a reservation", "make a reservation", "word_choice"),
    ), "restaurant host", ("make a reservation", "make a reservation"),
     (1, "also like a table for Sunday brunch", "周日中午", "make a reservation for two on Sunday at noon")),
    ("shuttle-rejected", (
        ("hotel", "I moved because was noisy.", "because was noisy", "because it was noisy", "sentence_structure"),
    ), "", (), ()),
])
def test_linked_content_uses_saved_targets_and_still_requires_review(
    monkeypatch, coaching_review_json, case, records, role, forms, facts,
):
    owner = TestClient(app, client=(f"coaching-linked-{case}", 50000), headers={"X-Client-Id": f"coaching-linked-{case}"})
    for scene, sentence, before, after, category in records:
        saved = owner.post("/api/sessions", json={
            "scenario_id": scene, "overall": 75, "messages": [{"role": "user", "content": sentence}],
            "corrections": [{"original": before, "suggestion": after, "note": "练习这个用法。", "category": category, "turn_index": 0}],
        })
        assert saved.status_code == 201
    revision = owner.get("/api/progress/coaching").json()["revision"]
    reviewed = []

    class Coach:
        async def chat(self, messages, **kwargs):
            material = json.loads(messages[-1]["content"])
            if "lesson" in material:
                reviewed.append(material)
                if case == "shuttle-rejected":
                    return coaching_review_json(problem="task", exercise=1)
                return coaching_review_json()
            # A failure in open-ended generation should not stop a supported lesson.
            return "{}"

    monkeypatch.setitem(app.dependency_overrides, get_client, Coach)
    response = owner.post("/api/progress/coaching/plan", params={"revision": revision})
    assert len(reviewed) == 1
    if case == "shuttle-rejected":
        assert response.status_code == 503
        return
    assert response.status_code == 200, response.text
    plan = response.json()
    scene = plan["scene"]
    assert role in scene["partner_role"]
    assert len(plan["evidence"]) == len(records)
    exercises = scene["practice_exercises"]
    assert tuple(exercise["target"]["form"] for exercise in exercises) == forms
    index, question, task, answer = facts
    assert question in exercises[index]["partner_line"]
    assert task in exercises[index]["task"]
    assert answer in exercises[index]["example"]


@pytest.mark.parametrize(("case", "record", "bad", "good", "other", "reviewed_bad"), [
    ("help", ("tense", "Last year I lead a demo.", "lead", "led"), (
        "Did anybody help you with the launch?", "说你上周带了发布团队。", "Last week I led the launch team.",
    ), (
        "Did anybody help you with the launch?", "告诉对方 Noor 帮了你，你上周带了发布团队。",
        "Noor helped me. I led the launch team last week.",
    ), ("What was your role in the workshop?", "说你主持了工作坊。", "I led the workshop last Tuesday."), False),
    ("decision", ("prepositions", "We can meet in Monday.", "in Monday", "on Monday"), (
        "Should we reserve the larger conference room?", "建议周五讨论项目。", "We could discuss the project on Friday.",
    ), (
        "Should we reserve the larger conference room?", "同意预订这间会议室，周五用它。",
        "Let's reserve it for the project meeting on Friday.",
    ), ("When can you call?", "说周六可以打电话。", "I can call on Saturday."), False),
    ("handover", ("articles", "I misplaced a key you gave me.", "a key", "the key"), (
        "Do you have the parcel?", "说你把刚交到你手上的包裹落在家里。",
        "I left the parcel you handed me a moment ago at home.",
    ), (
        "Do you have the parcel?", "说你把昨天交给你的包裹落在家里。",
        "I left the parcel you handed me yesterday at home.",
    ), ("Which items are ready?", "说明装零件的袋子已经准备好。", "The bag with the spare parts is ready."), False),
    ("place_scope", ("tense", "I live here for three years.", "live", "have lived"), (
        "And do you still live in the same neighborhood?", "告诉对方你在这个城市住了五年。",
        "I have lived in this city for five years.",
    ), (
        "And do you still live in the same neighborhood?", "告诉对方你在原来的小区住了五年，一直没搬。",
        "Yes, I have lived in the same neighborhood for five years.",
    ), ("How long has your flat been home for you?", "说你在现在的公寓住了一年。",
        "I have lived in my current flat for a year."), False),
    ("known_item", ("articles", "I need to check bag.", "bag", "a bag"), (
        "Do you have your passport with you?", "说你有护照，并把它递给对方。",
        "Yes, I have a passport here for you.",
    ), (
        "Any seating preference?", "告诉对方你想要一个靠窗座位。",
        "I'd like a window seat, please.",
    ), ("Do you have any luggage to check?", "说你想托运一个旅行袋。", "I need to check a duffel bag."), False),
    ("offer_direction", ("articles", "I need to check bag.", "bag", "a bag"), (
        "Do you need anything else from me?", "告诉对方你有一张机票，并把它递过去。",
        "Yes, I have a ticket here.",
    ), (
        "Do you need anything else from me?", "请对方给你一张纸质登机牌。",
        "Yes, could I get a printed boarding pass?",
    ), ("Do you have any luggage to check?", "说你想托运一个旅行袋。", "I need to check a duffel bag."), False),
    ("time_of_day", ("word_choice", "I'd like to do a reservation.", "do a reservation", "make a reservation"), (
        "When would you like the table?", "说你想订周五晚上七点的餐位。",
        "I'd like to make a reservation for Friday at seven.",
    ), (
        "When would you like the table?", "说你想订周五晚上七点的餐位。",
        "I'd like to make a reservation for Friday at 7 p.m.",
    ), ("How many people will there be for Sunday brunch?", "说你想订周日早午餐的五人桌。",
        "I'd like to make a reservation for five for Sunday brunch."), False),
    ("negative_review", ("articles", "I misplaced a key you gave me.", "a key", "the key"), (
        "Do you have the receipt?", "说你把昨天收到的收据落在车上。", "The box is still in my car.",
    ), (
        "Do you have the receipt?", "说你把昨天收到的收据落在车上。", "I left the receipt from yesterday in my car.",
    ), ("Which item is ready?", "说明装零件的袋子已经准备好。", "The bag with the spare parts is ready."), True),
    ("missing_review", ("articles", "I misplaced a key you gave me.", "a key", "the key"), (
        "Do you have the receipt?", "说你把昨天收到的收据落在车上。", "The box is still in my car.",
    ), (
        "Do you have the receipt?", "说你把昨天收到的收据落在车上。", "I left the receipt from yesterday in my car.",
    ), ("Which item is ready?", "说明装零件的袋子已经准备好。", "The bag with the spare parts is ready."), True),
])
def test_plan_retries_dialogue_defects_despite_an_overall_approval(
    monkeypatch, coaching_review_json, case, record, bad, good, other, reviewed_bad,
):
    category, sentence, before, after = record
    owner = TestClient(app, client=(f"coaching-dialogue-{case}", 50000), headers={"X-Client-Id": f"coaching-dialogue-{case}"})
    saved = owner.post("/api/sessions", json={
        "scenario_id": "friend", "overall": 75, "messages": [{"role": "user", "content": sentence}],
        "corrections": [{"original": before, "suggestion": after, "note": "练习这个用法。", "category": category, "turn_index": 0}],
    })
    assert saved.status_code == 201
    revision = owner.get("/api/progress/coaching").json()["revision"]
    drafted, reviewed = [], []

    class Coach:
        async def chat(self, messages, **kwargs):
            content = json.loads(messages[-1]["content"])
            if "lesson" in content:
                first = content["lesson"]["scene"]["practice_exercises"][0]["example"]
                reviewed.append(first)
                if first == bad[2]:
                    approved = {"answers_question": True, "fulfills_task": True, "timeline_consistent": True}
                    if case == "negative_review":
                        return coaching_review_json(turn_checks=[{**approved, "answers_question": False}, approved])
                    if case == "missing_review":
                        return coaching_review_json(turn_checks=[approved])
                return coaching_review_json()
            drafted.append(content)
            return json.dumps({"evidence": [1], "scene": {
                "title": "A short conversation", "title_zh": "练习口语", "partner_role": "A friendly partner",
                "goal": "回答两道问题。", "persona": "Ask short questions.", "opening_line": "Hi, can we talk?",
                "practice_cues": [{"keyword": "Let me think", "meaning": "思考时说", "sentence": "Let me think for a second."}],
                "practice_exercises": [
                    {"partner_line": question, "task": task, "example": example}
                    for question, task, example in (bad if len(drafted) == 1 else good, other)
                ],
            }})

    monkeypatch.setitem(app.dependency_overrides, get_client, Coach)
    result = owner.post("/api/progress/coaching/plan", params={"revision": revision})
    assert result.status_code == 200, result.text
    assert result.json()["scene"]["practice_exercises"][0]["example"] == good[2]
    assert len(drafted) == 2
    assert reviewed == ([bad[2], good[2]] if reviewed_bad else [good[2]])


def test_booking_follow_up_preserves_the_date_or_establishes_a_change():
    from app.schemas.coaching import PracticeExerciseDraft
    from app.services.coaching_dialogue import booking_follow_up_problem

    first = PracticeExerciseDraft(
        partner_line="What day and time would you like?", task="订周五晚上的餐位。",
        example="I'd like to make a reservation for Friday evening.",
    )
    second = PracticeExerciseDraft(
        partner_line="Of course. Would you like a table near the window?", task="订周六靠窗的餐位。",
        example="I'd like to make a reservation for Saturday near the window.",
    )
    assert booking_follow_up_problem(first, second)
    assert not booking_follow_up_problem(first, second.model_copy(update={
        "partner_line": "Would you like a separate booking for Saturday?",
    }))
    assert not booking_follow_up_problem(first, second.model_copy(update={
        "example": "I'd like to make a reservation for Friday near the window.",
    }))
