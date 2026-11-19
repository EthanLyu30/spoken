"""Reject direct-answer and time-order defects that have clear linguistic cues."""

import re

from app.schemas.coaching import PracticeExerciseDraft

_HELP_QUESTION = re.compile(
    r"^(?:(?:did|has|have|does|was) (?:anyone|anybody|someone|somebody) "
    r"(?:else )?(?:able to )?(?:help(?:ed|ing|s)?|assist(?:ed|ing|s)?|lend a hand|give you a hand)"
    r"|(?:did|have) you (?:get|got|had|have|received) (?:any |some )?help)\b"
)
_DIRECT_REPLY = re.compile(
    r"^(?:(?:well|sorry|actually),\s*)?"
    r"(?:(?:yes|no|yep|nope)(?=\s*[,!.?]|\s+(?:i|we|it|there)\b|$)"
    r"|(?:sure|of course|certainly|not really|not this time)(?=\s*[,!.?]|$))"
)
_HELP_REPLY = re.compile(
    r"\b(?:(?:helped|helps|assisted) (?:me|us)|(?:no one|nobody) (?:helped|did)"
    r"|gave (?:me|us) a hand|(?:i|we) (?:got|had|received) (?:some |no )?help|with the help of"
    r"|on (?:my|our) own|by (?:myself|ourselves)|without (?:any )?help)\b"
)
_PROPOSAL = re.compile(
    r"^(?:(?:should|shall) (?:we|i)|do you think (?:we|i) should) (?:go ahead and )?(?:book|reserve)\b"
)
_BOOKING_DECISION = re.compile(
    r"^(?:please )?(?:book|reserve)\b|\b(?:go ahead|let's(?: not)? (?:book|reserve|skip))\b"
    r"|\b(?:we|i) (?:should(?:n't| not)?|(?:don't|do not) need to|can|will) (?:book|reserve)\b"
)
_SAME_ADDRESS = re.compile(
    r"^(?:(?:and|so),? )?(?:do|are|have) you\b[^.!?]{0,80}\b(?:the )?same "
    r"(?:neighbou?rhood|street|house|flat|apartment|building|address)\b"
)
_BROAD_LOCATION = re.compile(r"\bin (?:this|that|the|our|my|the same) (?:city|town|country)\b")
_ADDRESS_REPLY = re.compile(r"\b(?:moved|same (?:neighbou?rhood|street|house|flat|apartment|building|address|place)|live at)\b")
_KNOWN_ITEM = re.compile(r"^(?:do you (?:still )?have|did you bring|have you brought) (?:your|the) ([a-z]+)(?: with you| today)?$")
_OFFER_FROM_PARTNER = re.compile(r"^(?:do you need|is there) (?:anything|something)(?: else)? (?:you need )?from me$")
_POSSESSION_REPLY = re.compile(
    r"^(?:yes[,.]\s*)?(?:i|we) (?:have|brought|have brought) (a|an|the|my|our|your) ([a-z]+)"
    r"(?: (?:here|with me|with us|for you))*[.!]?$"
)
_CLOCK_HOUR_ZH = r"\s*[0-9０-９零〇一二两三四五六七八九十]+\s*点"
_DAYPARTS = (
    (re.compile(rf"(?:清晨|早上|上午){_CLOCK_HOUR_ZH}"),
     re.compile(r"\b(?:morning|breakfast|0[0-9]:[0-5]\d)\b|(?<![a-z])a\.?m\b")),
    (re.compile(rf"(?:下午|傍晚|晚上){_CLOCK_HOUR_ZH}"),
     re.compile(r"\b(?:afternoon|evening|night|dinner|(?:1[2-9]|2[0-3]):[0-5]\d)\b|(?<![a-z])p\.?m\b")),
)
_WEEKDAY = re.compile(r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b")
_BOOKING = re.compile(r"\b(?:book|reserve|reservation|booking)\b")
_FOLLOW_UP = re.compile(r"^(?:and\b|(?:of course|sure|great|okay|all right|got it)[,.!]\s*|(?:what|which) name\b)")
_BOOKING_CHANGE = re.compile(r"\b(?:(?:separate|another|new) (?:reservation|booking)|(?:different|another) (?:day|date)|instead)\b")

_HANDOVER = r"(?:gave|handed|passed|lent|sold|sent) (?:it to )?(?:me|you|us)"
_RECENT_HANDOVER = re.compile(
    rf"\b(?:just {_HANDOVER}|{_HANDOVER}\b[^,;.!?]{{0,45}}\b(?:just now|a moment ago|moments ago|seconds ago))\b"
)
_LEFT_ELSEWHERE = re.compile(
    r"\b(?:left|forgot) ((?:the|this|that|my|our|your|his|her|their|it|them|a|an)\b[^,;.!?]{0,115}?) "
    r"(?:at home|in (?:my|our|the) (?:car|room)|back at (?:my |our |the )?(?:hotel|office|shop))\b"
)
_RECENT_TASK = re.compile(
    r"(?:刚才|刚刚|方才|刚)(?:给[你我]|递给[你我]|交给[你我]|交到[你我](?:的)?手[上里]|发给[你我])"
    r"[^，。；！？]{0,45}(?:落|忘|留)在(?:了)?(?:家里|车上|酒店|办公室)"
)


def _normalized(text: str) -> str:
    return " ".join(text.casefold().replace("’", "'").split())


def dialogue_problem(exercise: PracticeExerciseDraft) -> str | None:
    question = _normalized(exercise.partner_line)
    questions = re.findall(r"([^.!?]+)\?", question)
    prompt = (questions[-1] if questions else question).strip()
    answer = _normalized(exercise.example)
    if _HELP_QUESTION.match(prompt) and not (_DIRECT_REPLY.match(answer) or _HELP_REPLY.search(answer)):
        return "Answer whether anyone helped, with a yes/no answer or an explicit helper, before giving the other detail."

    if _PROPOSAL.match(prompt) and not (_DIRECT_REPLY.match(answer) or _BOOKING_DECISION.search(answer)):
        return "Accept or decline the booking directly. Give the date or other details after the decision."

    if (_SAME_ADDRESS.match(prompt) and _BROAD_LOCATION.search(answer)
            and not (_DIRECT_REPLY.match(answer) or _ADDRESS_REPLY.search(answer))):
        return "Answer whether the learner is still at the specific place asked about. A city alone does not answer that."

    if possession := _POSSESSION_REPLY.fullmatch(answer):
        if _OFFER_FROM_PARTNER.match(prompt):
            return "Answer what the learner needs from the partner. Giving the partner an item reverses who is offering help."
        if (known := _KNOWN_ITEM.match(prompt)) and possession[1] in {"a", "an"} and possession[2] == known[1]:
            return "The partner asks for a specific item. To practise a or an, ask about an item that has not been identified yet."

    spoken_time = re.sub(r"\bgood (?:morning|afternoon|evening)\b", "", question) + " " + answer
    if any(required.search(exercise.task) and not stated.search(spoken_time) for required, stated in _DAYPARTS):
        return "Keep the time of day from the task. If the question does not establish morning or evening, write a.m. or p.m. in the answer."

    recent_question = _RECENT_HANDOVER.search(question)
    for left in _LEFT_ELSEWHERE.finditer(answer):
        item = left[1]
        if _RECENT_HANDOVER.search(item) or (recent_question and item in {"it", "them", "that"}):
            return "Keep the timeline consistent. An item just handed over here could not already have been left elsewhere."
    if _RECENT_TASK.search(exercise.task):
        return "Keep the timeline in the Chinese task consistent. Establish an earlier handover before leaving the item elsewhere."
    return None


def booking_follow_up_problem(first: PracticeExerciseDraft, second: PracticeExerciseDraft) -> str | None:
    question = _normalized(second.partner_line)
    answers = [_normalized(exercise.example) for exercise in (first, second)]
    if not _FOLLOW_UP.match(question) or not all(_BOOKING.search(answer) for answer in answers):
        return None
    first_days, second_days = (set(_WEEKDAY.findall(answer)) for answer in answers)
    if (first_days and second_days and first_days.isdisjoint(second_days)
            and second_days.isdisjoint(_WEEKDAY.findall(question)) and not _BOOKING_CHANGE.search(question)):
        return "Keep the same booking date in exercise 2, or make the change or separate booking explicit in its partner line."
    return None
