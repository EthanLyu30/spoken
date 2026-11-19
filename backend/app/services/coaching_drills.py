"""Paired speaking turns for common corrections in everyday situations.

Each partner line, task and reference answer is authored together. The plan
service checks the selected turns and reviews them with the same gate it uses
for generated material.
"""

from collections import defaultdict

from app.schemas.coaching import CoachingExample, CoachingPlanDraft, CoachingSceneDraft, PracticeExercise, PracticeTarget
from app.schemas.custom import CustomScene, PracticeCue
from app.services.coaching_targets import select_targets

_TRAVEL_SCENES = {"airport", "hotel", "directions", "restaurant"}
_WORK_SCENES = {"standup", "negotiation", "interview", "presentation", "oneonone"}


def _turn(question: str, task: str, hint: str, answer: str) -> PracticeExercise:
    return PracticeExercise(partner_line=question, task=task, hint=hint, example=hint.replace("___", answer))


def _scene(title: str, title_zh: str, role: str, opening: str, cue: PracticeCue) -> CustomScene:
    return CustomScene(
        title=title, title_zh=title_zh, partner_role=role, opening_line=opening,
        goal=title_zh, persona=f"You are {role}. Ask short follow-up questions about this situation.",
        practice_cues=[cue],
    )


_SCENES = {
    "past": _scene(
        "Catching up after a trip", "出差归来和同事聊近况", "a colleague catching up after your trip",
        "How was your trip? Did you get any time to yourself?",
        PracticeCue(keyword="before I left", meaning="说一件出发前做的事", sentence="I packed my bag before I left."),
    ),
    "work_past": _scene(
        "Catching up on a project", "跟同事聊项目进展", "a colleague catching up on a project",
        "How did things go with the project last week?",
        PracticeCue(keyword="give someone a hand", meaning="表示搭把手、帮个忙", sentence="Can you give me a hand with this report?"),
    ),
    "definite": _scene(
        "Returning headphones to a shop", "带着耳机到店里退货", "a returns clerk at an electronics shop",
        "Hi, what can I help you with today?",
        PracticeCue(keyword="return an item", meaning="到店退货时说明来意", sentence="I'd like to return an item I ordered online."),
    ),
    "time_preposition": _scene(
        "Setting the meeting schedule", "和同事安排这周的会议", "a colleague organizing this week's meetings",
        "We have a couple of meetings to schedule this week. When are you free?",
        PracticeCue(keyword="work for you", meaning="问对方安排是否合适", sentence="Does lunchtime work for you?"),
    ),
    "indefinite": _scene(
        "Checking in for a flight", "在机场柜台值机", "an airport check-in agent",
        "Good morning. Where are you flying to today?",
        PracticeCue(keyword="check in for", meaning="在柜台说明要办理哪班航班的值机", sentence="I'm here to check in for my flight to Seoul."),
    ),
    "article_sound": _scene(
        "Asking for things at a hotel", "向酒店前台借用物品", "a hotel front desk clerk",
        "Good evening. Is everything all right with your room?",
        PracticeCue(keyword="send something up", meaning="请前台把东西送到客房", sentence="Could you send up some towels, please?"),
    ),
    "perfect": _scene(
        "Meeting someone at a networking event", "在行业交流会上认识新朋友", "another attendee at a local networking event",
        "Hi, is this your first time at one of these events?",
        PracticeCue(keyword="these days", meaning="聊近况时表示最近这段时间", sentence="What keeps you busy these days?"),
    ),
    "expression": _scene(
        "Calling a restaurant to book a table", "打电话订餐厅座位", "a restaurant host taking bookings over the phone",
        "Good evening. Thanks for calling. How can I help?",
        PracticeCue(keyword="under the name", meaning="告诉接待员用谁的名字登记", sentence="Could you put it under the name Chen?"),
    ),
    "reason": _scene(
        "Why the trip plans changed", "旅途中为什么改了计划", "a travel companion comparing notes after the trip",
        "A few of our plans changed on that trip. What happened?",
        PracticeCue(keyword="make other plans", meaning="说原安排有变化，需要另作打算", sentence="We had to make other plans."),
    ),
    "bare_plural": _scene(
        "Planning a trip together", "和旅伴一起安排出行", "a travel companion planning the trip with you",
        "Let's plan our trip. How do you usually choose where to stay?",
        PracticeCue(keyword="stay somewhere", meaning="表示还没确定住在哪里", sentence="I'd like to stay somewhere near the station."),
    ),
    "embedded_question": _scene(
        "Finding your way around the station", "在车站问路", "a station information clerk",
        "Good morning. How can I help you?",
        PracticeCue(keyword="on this floor", meaning="说某个地方就在这一层", sentence="The cafe is on this floor."),
    ),
    "agreement": _scene(
        "Handing over supplier work", "交接供应商工作", "a colleague taking over supplier work",
        "Before you go, could you walk me through who does what?",
        PracticeCue(keyword="point of contact", meaning="交接时说明遇到问题可以联系谁", sentence="I'll give you a point of contact."),
    ),
}

_TURNS = {
    "past": {
        "visited": (
            _turn(
                "Which exhibit did you see at the railway museum on Saturday?",
                "告诉同事你周六下午参观了铁路博物馆的蒸汽机展。",
                "I ___ the steam engine exhibit at the railway museum on Saturday afternoon.", "visited",
            ),
            _turn(
                "Where did you go on Sunday morning before work started?",
                "告诉同事你周日早上去了河边的植物园。",
                "I ___ the botanical garden by the river on Sunday morning.", "visited",
            ),
        ),
        "finished": (
            _turn(
                "What work did you get done before your train home?",
                "告诉同事你在坐火车回家前完成了预算表。",
                "I ___ the budget sheet before I took the train home.", "finished",
            ),
            _turn(
                "What did you get done while you were waiting at the airport?",
                "告诉同事你等飞机时写完了客户会议的纪要。",
                "I ___ the client meeting notes while I was waiting at the airport.", "finished",
            ),
        ),
    },
    "work_past": {
        "sent": (
            _turn(
                "How did the client get the updated schedule yesterday?",
                "告诉同事你昨天把更新后的日程发给了客户。",
                "I ___ the updated schedule to the client yesterday.", "sent",
            ),
            _turn(
                "How did the designer get a copy of the brief before the kickoff?",
                "告诉同事你在启动会前给设计师发了一份需求说明。",
                "I ___ the designer a copy of the brief before the kickoff.", "sent",
            ),
        ),
        "led": (
            _turn(
                "Did anyone help you with the training session?",
                "先说 Maya 帮了你，再告诉同事你上周五主持了那场培训。",
                "Yes, Maya helped me. I ___ the training session last Friday.", "led",
            ),
            _turn(
                "What was your role at yesterday's kickoff?",
                "告诉同事你主持了昨天的项目启动会。",
                "I ___ the kickoff meeting yesterday.", "led",
            ),
        ),
    },
    "definite": {
        "": (
            _turn(
                "How can I help you with your return?",
                "告诉店员你昨天在这儿买的那副耳机开不了机。",
                "___ headphones I bought here yesterday won't turn on.", "The",
            ),
            _turn(
                "I see you bought those headphones yesterday. Did you bring any packaging back today?",
                "告诉店员没带包装，你今早把原包装盒落在家里了。",
                "No, I left ___ original box at home this morning.", "the",
            ),
        ),
    },
    "time_preposition": {
        "on": (
            _turn(
                "When can you join the planning call this week?",
                "告诉同事你周三可以参加计划讨论的电话会议。",
                "I can join the planning call ___ Wednesday.", "on",
            ),
            _turn(
                "Should we book the small meeting room for the budget review?",
                "同意订这间小会议室，提议周四在这里开预算会。",
                "Yes, let's book it for the budget review ___ Thursday.", "on",
            ),
        ),
    },
    "indefinite": {
        "": (
            _turn(
                "Are you checking any luggage today?",
                "告诉值机员你要托运一个行李箱。",
                "Yes, I'm checking ___ suitcase.", "a",
            ),
            _turn(
                "Where would you like to sit?",
                "告诉值机员你想要一个靠过道的座位。",
                "I'd like ___ aisle seat, please.", "an",
            ),
        ),
    },
    "article_sound": {
        "": (
            _turn(
                "Is there anything you need for your room?",
                "告诉前台你需要一个吹风机。",
                "Yes, I need ___ hairdryer.", "a",
            ),
            _turn(
                "Do you need anything to charge your devices?",
                "请前台借一个转换插头，给手机充电。",
                "Yes, could I borrow ___ adapter to charge my phone?", "an",
            ),
        ),
    },
    "perfect": {
        "worked": (
            _turn(
                "How long have you been with your current company?",
                "告诉对方你在现在这家设计公司工作两年了。",
                "I ___ at my design firm for two years.", "have worked",
            ),
            _turn(
                "How long have you been in healthcare?",
                "告诉对方你从 2022 年起就在医疗行业工作。",
                "I ___ in healthcare since 2022.", "have worked",
            ),
        ),
        "lived": (
            _turn(
                "How long has this city been home for you?",
                "告诉对方你在这座城市住了五年。",
                "I ___ here for five years.", "have lived",
            ),
            _turn(
                "How long have you been in your current place?",
                "告诉对方你从去年六月起就住在现在这套公寓。",
                "I ___ in my current apartment since last June.", "have lived",
            ),
        ),
    },
    "expression": {
        "make a reservation": (
            _turn(
                "What day and time would you like the table?",
                "告诉接待员你想订周五晚上七点的四人桌。",
                "I'd like to ___ for four at seven on Friday evening.", "make a reservation",
            ),
            _turn(
                "Would you also like a table for Sunday brunch?",
                "告诉接待员你还想订周日中午的两人桌。",
                "Yes, I'd like to ___ for two on Sunday at noon.", "make a reservation",
            ),
        ),
    },
    "reason": {
        "": (
            _turn(
                "Why did you take a taxi from the station?",
                "告诉旅伴，车站的接驳车没来，所以你打车了。",
                "I took a taxi from the station because ___.", "the shuttle did not come",
            ),
            _turn(
                "Why did you have dinner at the station?",
                "告诉旅伴，你在车站吃了晚饭，因为酒店的餐厅关门了。",
                "I had dinner at the station because ___.", "the hotel restaurant was closed",
            ),
        ),
    },
    "bare_plural": {
        "": (
            _turn(
                "What do you look at first before booking a room?",
                "告诉旅伴你订房之前会先看照片。",
                "I check ___ before I book a room.", "photos",
            ),
            _turn(
                "How do you usually travel between cities?",
                "告诉旅伴你一般在城市之间坐巴士。",
                "I usually take ___ between cities.", "buses",
            ),
        ),
    },
    "embedded_question": {
        "": (
            _turn(
                "Are you looking for anything in the station?",
                "礼貌地问工作人员行李寄存柜在哪里。",
                "Could you tell me where ___?", "the luggage lockers are",
            ),
            _turn(
                "Is there anywhere else you need to find?",
                "问工作人员自动售票机在哪里。",
                "Do you know where ___?", "the ticket machines are",
            ),
        ),
    },
    "agreement": {
        "handles": (
            _turn(
                "Who should I contact about supplier invoices?",
                "告诉接手工作的同事，你们的会计负责供应商发票。",
                "Our accountant ___ the supplier invoices.", "handles",
            ),
            _turn(
                "Where should I send questions about damaged goods?",
                "告诉同事售后团队负责处理损坏的商品。",
                "Our support team ___ damaged goods.", "handles",
            ),
        ),
        "delivers": (
            _turn(
                "What day should I expect the cartons?",
                "告诉同事你们的供应商每周三送箱子。",
                "Our supplier ___ the cartons on Wednesdays.", "delivers",
            ),
            _turn(
                "When should I be here to receive the spare parts?",
                "告诉同事承运商每周五送备用零件。",
                "The carrier ___ the spare parts on Fridays.", "delivers",
            ),
        ),
    },
}

_BANKS_BY_TARGET = {
    "past": (("past", _TRAVEL_SCENES), ("work_past", _WORK_SCENES)),
    "definite": (("definite", {"shopping"}),),
    "time_preposition": (("time_preposition", _WORK_SCENES),),
    "indefinite": (("indefinite", {"airport"}),),
    "article_sound": (("article_sound", {"hotel"}),),
    "perfect": (("perfect", {"interview", "networking"}),),
    "expression": (("expression", {"restaurant"}),),
    "reason": (("reason", _TRAVEL_SCENES),),
    "bare_plural": (("bare_plural", _TRAVEL_SCENES),),
    "embedded_question": (("embedded_question", _TRAVEL_SCENES),),
    "agreement": (("agreement", _WORK_SCENES),),
}


def linked_draft(category: str, examples: list[CoachingExample], targets: list[PracticeTarget]) -> CoachingPlanDraft | None:
    banks = [bank for bank, scenes in _BANKS_BY_TARGET.get(targets[0].kind, ())
             if any(example.scenario_id in scenes for example in examples)]
    if not banks:
        return None

    # Bind each practiced form to an actual saved correction. Prefer covering
    # two forms, then take two situations for one form if that's all we have.
    sources: dict[str, list[int]] = defaultdict(list)
    for index, example in enumerate(examples, 1):
        _, grounded = select_targets(category, [example])
        for form in {target.form for target in grounded if target in targets}:
            sources[form].append(index)
    for bank in banks:
        chosen = [(form, turns[slot]) for slot in range(2) for form, turns in _TURNS[bank].items() if form in sources][:2]
        if len(chosen) == 2:
            break
    else:
        return None

    citations = list(dict.fromkeys(sources[form][0] for form, _ in chosen))
    if len(citations) == 1:
        alternatives = sources[chosen[0][0]][1:2]
        citations.extend(alternatives)
    scene = CoachingSceneDraft(
        **_SCENES[bank].model_dump(),
        practice_exercises=[turn.model_copy() for _, turn in chosen],
    )
    return CoachingPlanDraft(evidence=citations, scene=scene)
