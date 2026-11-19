"""Finite checks for supported edits in guided speaking exercises.

Unrecognized edits remain available for replay. These rules check the target
wording, leaving the wider meaning and naturalness to the conversation coach.
"""

import re
from collections import defaultdict
from difflib import SequenceMatcher

from app.schemas.coaching import CoachingExample, PracticeTarget

_ARTICLES = {"a", "an", "the"}
_PREPOSITIONS = {"in", "on", "at", "for", "to", "of", "with", "from", "about", "by"}
_SUBJECTS = {"i", "you", "he", "she", "it", "we", "they"}
_THIRD_SINGULAR = {"he", "she", "it"}
_DETERMINERS = _ARTICLES | {"this", "that", "my", "our", "your", "his", "her", "its", "their"}
_BE = {"am", "is", "are", "was", "were"}
_AUXILIARIES = _BE | {"will", "would", "could", "can", "shall", "should", "may", "might", "must",
                      "have", "has", "had", "do", "does", "did", "be", "been", "being"}
_ADVERBS = {"already", "just", "also", "finally", "recently", "really", "usually", "still", "always", "never", "not"}
_WEEKDAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
_MONTHS = set("january february march april may june july august september october november december".split())
_MASS = set("advice baggage bread cash coffee equipment furniture information luggage money music rice traffic water work".split())
_PLURALS = {"people", "children", "men", "women", "teeth", "feet", "mice"}
_NOUN_BEFORE = _PREPOSITIONS | {"read", "like", "prefer", "see", "check", "buy", "take", "visit", "need", "want",
                                 "use", "order", "carry", "serve", "sell", "compare", "get", "drink", "eat", "have", "offer"}
_NOUN_MODIFIERS = {"small", "large", "local", "new", "cheap", "online", "fresh", "hot", "cold", "good", "public"}
_REASON_VERBS = {"need", "want", "like", "prefer", "feel", "work", "live", "worry", "start", "finish", "miss", "hurt"}
_QUESTION_INTROS = (("tell", "me"), ("do", "you", "know"), ("know",), ("wonder",), ("explain",), ("remember",))
_WH = {"where", "when", "how", "why", "what"}
_FIXED_PREPOSITIONS = set(("depend on", "listen to", "good at", "interested in", "wait for", "look for",
                           "talk about", "agree with", "apply for", "arrive at", "arrive in"))
_PAST = dict(zip(
    "begin break bring buy catch come cut do drink drive eat fall feel find fly forget get give go grow have hear hold keep know lead leave let lose make meet pay put read ride run say see sell send sit sleep speak spend stand swim take teach tell think understand wear win write".split(),
    "began broke brought bought caught came cut did drank drove ate fell felt found flew forgot got gave went grew had heard held kept knew led left let lost made met paid put read rode ran said saw sold sent sat slept spoke spent stood swam took taught told thought understood wore won wrote".split(),
))
_PARTICIPLES = dict(zip(
    "begin break come drink drive eat fall fly forget get give go grow know ride run see speak swim take wear write".split(),
    "begun broken come drunk driven eaten fallen flown forgotten gotten given gone grown known ridden run seen spoken swum taken worn written".split(),
))
_PARTICIPLE_FORMS = {_PARTICIPLES.get(verb, past) for verb, past in _PAST.items()} | {"been"}
_CONTRACTIONS = {"i've": ["i", "have"], "you've": ["you", "have"], "we've": ["we", "have"], "they've": ["they", "have"]}
_WORD = re.compile(r"[a-z]+(?:'[a-z]+)?|\d+(?::\d+)?")
_SENTENCE = re.compile(r"[.!?;\n]+")
_VOWEL_SOUND = re.compile(r"^(?:honest|honor|honour|hour|heir|mri|mba|fbi|ngo|sos|xray)")
_CONSONANT_SOUND = re.compile(r"^(?:one|once|euro|user|use|usual|unique|unicorn|uniform|united|unit|university|union|ubiquit|ufo|uk)")


def words(text: str) -> tuple[str, ...]:
    return tuple(part for word in _WORD.findall(text.casefold().replace("’", "'"))
                 for part in _CONTRACTIONS.get(word, (word,)))


def _past_of(word: str) -> set[str]:
    if word in _PAST:
        return {_PAST[word]}
    if word in _BE or word == "be":
        return {"was", "were"}
    if word.endswith("e"):
        return {word + "d"}
    if re.search(r"[^aeiou]y$", word):
        return {word[:-1] + "ied"}
    if word.endswith("c"):
        return {word + "ked"}
    forms = {word + "ed"}
    if re.search(r"[^aeiou][aeiou][bdfgklmnprstz]$", word):
        forms.add(word + word[-1] + "ed")
    return forms


def _third_of(word: str) -> str:
    if word in {"be", "are", "am"}:
        return "is"
    if word == "have":
        return "has"
    if re.search(r"[^aeiou]y$", word):
        return word[:-1] + "ies"
    return word + ("es" if word.endswith(("s", "x", "z", "ch", "sh", "o")) else "s")


def _plural(word: str) -> bool:
    return word in _PLURALS or (len(word) > 2 and word.endswith("s") and not word.endswith(("ss", "us", "is")))


def _previous(tokens: tuple[str, ...], index: int) -> int:
    index -= 1
    while index >= 0 and tokens[index] in _ADVERBS:
        index -= 1
    return index


def _subject(tokens: tuple[str, ...]) -> str | None:
    if len(tokens) == 1 and tokens[0] in _SUBJECTS:
        return tokens[0]
    if 2 <= len(tokens) <= 5 and tokens[0] in _DETERMINERS:
        if not set(tokens[1:]) & (_AUXILIARIES | _SUBJECTS | _PREPOSITIONS | _DETERMINERS):
            return "they" if _plural(tokens[-1]) else "it"
    return None


def _subject_before(tokens: tuple[str, ...], index: int) -> str | None:
    end = _previous(tokens, index) + 1
    return next((subject for size in range(1, min(end, 5) + 1)
                 if (subject := _subject(tokens[end - size:end]))), None)


def _time_context(tokens: tuple[str, ...]) -> str:
    if not tokens:
        return ""
    if tokens[0].removesuffix("s") in _WEEKDAYS or (len(tokens) > 1 and (
        (tokens[0] in _MONTHS and re.fullmatch(r"[1-9]|[12]\d|3[01]", tokens[1]))
        or (tokens[1] in _MONTHS and re.fullmatch(r"[1-9]|[12]\d|3[01]", tokens[0]))
    )):
        return "day"
    if tokens[0] in {"noon", "midnight"} or re.fullmatch(r"\d{1,2}(?::\d{2})?", tokens[0]):
        return "clock"
    if tokens[0] in _MONTHS or re.fullmatch(r"\d{4}", tokens[0]) or tokens[:2] in {
        ("the", "morning"), ("the", "afternoon"), ("the", "evening"),
    }:
        return "period"
    if tokens[0] in {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                     "ten", "eleven", "twelve", "half", "quarter"}:
        return "clock"
    return ""


def _uses_an(word: str) -> bool:
    return bool(_VOWEL_SOUND.match(word)) or (word[0] in "aeiou" and not _CONSONANT_SOUND.match(word))


def target_spans(tokens: tuple[str, ...], target: PracticeTarget):
    """Yield the part of each match the learner must supply in the blank."""
    kind, form, context = target.kind, target.form, target.context
    phrase = words(form)
    for index, token in enumerate(tokens):
        following = tokens[index + 1:]
        previous = tokens[index - 1] if index else ""
        if kind in {"indefinite", "article_sound", "definite"} and following:
            noun = following[0]
            if noun.isalpha() and noun not in _DETERMINERS | _PREPOSITIONS | _SUBJECTS | _AUXILIARIES:
                if (kind == "definite" and token == "the") or (
                    kind != "definite" and token == ("an" if _uses_an(noun) else "a")
                ):
                    yield index, index + 1
        elif kind in {"bare_plural", "bare_mass"} and (previous in _NOUN_BEFORE or
             (index >= 2 and previous in _NOUN_MODIFIERS and tokens[index - 2] in _NOUN_BEFORE)):
            if token in _MASS if kind == "bare_mass" else _plural(token):
                yield index, index + 1
        elif kind == "past" and token == form and _subject_before(tokens, index):
            yield index, index + 1
        elif kind == "perfect" and token == form:
            aux = _previous(tokens, index)
            if aux >= 0 and tokens[aux] in {"have", "has"}:
                subject = _subject_before(tokens, aux)
                if subject and ("has" if subject in _THIRD_SINGULAR else "have") == tokens[aux]:
                    yield aux, index + 1
        elif kind == "agreement" and token == form:
            subject = _subject_before(tokens, index)
            if subject in (_THIRD_SINGULAR if context == "singular" else {"we", "they"}):
                yield index, index + 1
        elif kind == "embedded_question" and token in _WH:
            if any(index >= len(intro) and tokens[index - len(intro):index] == intro for intro in _QUESTION_INTROS):
                for size in range(1, min(6, len(following))):
                    if following[size] in _BE and _subject(following[:size]):
                        yield index + 1, index + size + 2
        elif kind == "reason" and token == "because" and index >= 2:
            for size in range(1, min(6, len(following))):
                verb = following[size]
                if _subject(following[:size]) and (verb in _AUXILIARIES | _PAST.keys() | _REASON_VERBS or verb.endswith("ed")):
                    yield index + 1, index + size + 2
        elif kind == "time_preposition" and token == form and _time_context(following) == context:
            yield index, index + 1
        elif kind in {"fixed_preposition", "expression"} and phrase and tokens[index:index + len(phrase)] == phrase:
            end = index + len(phrase)
            yield (end - 1 if kind == "fixed_preposition" else index), end


def _matching_spans(text: str, target: PracticeTarget):
    offset = 0
    for sentence in _SENTENCE.split(text):
        tokens = words(sentence)
        for start, end in target_spans(tokens, target):
            yield offset + start, offset + end
        offset += len(tokens)


def uses_target(text: str, target: PracticeTarget, blank: tuple[int, int] | None = None) -> bool:
    return any(blank is None or blank[0] <= start < end <= blank[1]
               for start, end in _matching_spans(text, target))


def target_hint(text: str, target: PracticeTarget) -> str | None:
    span = next(_matching_spans(text, target), None)
    normalized = text.casefold().replace("’", "'")
    if span is None or len(normalized) != len(text):
        return None
    # A contraction can expand to several tokens. Keep its original spelling
    # and blank the whole contraction if any part of it belongs to the target.
    bounds = [match.span() for match in _WORD.finditer(normalized) for _ in words(match[0])]
    start, end = span
    return text[:bounds[start][0]] + "___" + text[bounds[end - 1][1]:]


def _tense_target(old: tuple[str, ...], new: tuple[str, ...], previous: str) -> PracticeTarget | None:
    if len(old) != 1 or not new or len(old[0]) > 40:
        return None
    base = old[0]
    present_perfect = (len(new) == 2 and new[0] in {"have", "has"}) or (
        len(new) == 1 and previous in {"have", "has"}
    )
    if present_perfect:
        if base not in _PARTICIPLES:
            base = next((stem for stem, past in _PAST.items() if past == base), base)
        forms = {_PARTICIPLES[base]} if base in _PARTICIPLES else _past_of(base)
        if new[-1] in forms:
            return PracticeTarget(kind="perfect", form=new[-1], instruction=f"用 {base} 的现在完成时表达经历或持续至今的事。")
    elif len(new) == 1 and previous not in _AUXILIARIES and new[0] in _past_of(base):
        return PracticeTarget(kind="past", form=new[0], instruction=f"用 {base} 的一般过去式说已经完成的事。")
    return None


def tense_pattern(old: tuple[str, ...], new: tuple[str, ...], left: tuple[str, ...],
                  right: tuple[str, ...]) -> str | None:
    """Identify the tense of the changed verb, including auxiliaries outside a saved fragment."""
    index = _previous(left, len(left))
    previous = left[index] if index >= 0 else ""
    if previous in {"haven't", "hasn't"}:
        previous = "have"
    elif previous in (_AUXILIARIES - {"have", "has"}) | {"to"} or previous.endswith(("n't", "'s", "'d")):
        return None
    target = _tense_target(old, new, previous)
    if target and (target.kind != "past" or old[0] not in {"was", "were"}):
        return "past_simple" if target.kind == "past" else "present_perfect"
    # The correction may remove an incorrect perfect rather than introduce one.
    if len(old) == 2 and old[0] in {"have", "has"} and _tense_target(new, old, previous):
        return "present_perfect"
    if (not old and new in {("have",), ("has",)}) or (not new and old in {("have",), ("has",)}):
        following = next((word for word in right if word not in _ADVERBS), "")
        if following.endswith("ed") or following in _PARTICIPLE_FORMS:
            return "present_perfect"
    return None


def is_preposition_change(old: tuple[str, ...], new: tuple[str, ...]) -> bool:
    return old != new and len(old) <= 1 and len(new) <= 1 and all(word in _PREPOSITIONS for word in old + new)


def target_from_edit(category: str, before: tuple[str, ...], after: tuple[str, ...]) -> PracticeTarget | None:
    edits = [(i, j, k, l) for tag, i, j, k, l in SequenceMatcher(a=before, b=after, autojunk=False).get_opcodes()
             if tag != "equal"]
    changes = [(before[i:j], after[k:l]) for i, j, k, l in edits]
    if category == "articles" and len(changes) == 1:
        old, new = changes[0]
        if old in {("a",), ("an",), ()} and new == ("the",):
            return PracticeTarget(kind="definite", instruction="用 the 指明双方知道的那一个。")
        if new in {("a",), ("an",)}:
            kind = "article_sound" if old in {("a",), ("an",)} else "indefinite"
            if old in {(), ("a",), ("an",), ("the",)}:
                return PracticeTarget(kind=kind, instruction="在单数名词前选 a 或 an。")
        if old in {("a",), ("an",), ("the",)} and not new and after:
            if _plural(after[-1]):
                return PracticeTarget(kind="bare_plural", instruction="泛指这类事物时，直接用复数名词。")
            if after[-1] in _MASS:
                return PracticeTarget(kind="bare_mass", instruction="泛指这种不可数事物时，直接用名词。")
    if category == "tense" and len(changes) == 1:
        old, new = changes[0]
        previous = _previous(after, edits[0][2])
        return _tense_target(old, new, after[previous] if previous >= 0 else "")
    if category == "agreement" and len(changes) == 1:
        old, new = changes[0]
        if len(old) == len(new) == 1 and len(old[0]) <= 40 and len(new[0]) <= 40:
            if new[0] == _third_of(old[0]) or (new[0], old[0]) == ("was", "were"):
                return PracticeTarget(kind="agreement", form=new[0], context="singular",
                                      instruction=f"用第三人称单数主语，调整动词 {old[0]} 的形式。")
            if old[0] == _third_of(new[0]) or (new[0], old[0]) == ("were", "was"):
                return PracticeTarget(kind="agreement", form=new[0], context="plural",
                                      instruction="用复数主语，注意主语和动词一致。")
    if category == "word_order" and before and after:
        for index, wh in enumerate(before[:-1]):
            if wh in _WH and before[index + 1] in _BE and any(
                word == wh and any(after[end] in _BE and _subject(after[start + 1:end])
                                   for end in range(start + 2, len(after)))
                for start, word in enumerate(after)
            ):
                return PracticeTarget(kind="embedded_question", instruction="用间接问句提问，把主语放在 be 动词前。")
    if category == "sentence_structure" and "because" in after:
        reason = PracticeTarget(kind="reason", instruction="先说一件事，再用 because 接有主语和动词的原因。")
        prefix = ("i", "left") if before[:1] == after[:1] == ("because",) else ()
        if list(target_spans(prefix + after, reason)) and not list(target_spans(prefix + before, reason)):
            return reason
    if category == "prepositions" and len(changes) == 1:
        old, new = changes[0]
        if new and is_preposition_change(old, new):
            prep = new[0]
            index = edits[0][2]
            scope = _time_context(after[index + 1:])
            if {"day": "on", "clock": "at", "period": "in"}.get(scope) == prep:
                label = {"day": "用英语说星期几或具体日期，注意选对介词。", "clock": "用英语说具体几点，注意选对介词。",
                         "period": "用英语说月份、年份或时段，注意选对介词。"}[scope]
                return PracticeTarget(kind="time_preposition", form=prep, context=scope, instruction=label)
            pair = " ".join(after[max(0, index - 1):index + 1])
            if pair in _FIXED_PREPOSITIONS:
                return PracticeTarget(kind="fixed_preposition", form=pair, instruction=f"练习 {after[index - 1]} 后接哪个介词。")
    if category == "word_choice" and before != after and 2 <= len(after) <= 5:
        form = " ".join(after)
        if len(form) <= 80:
            return PracticeTarget(kind="expression", form=form, instruction=f"在新情境里用 {form} 表达。")
    return None


def select_targets(category: str, examples: list[CoachingExample]) -> tuple[list[CoachingExample], list[PracticeTarget]]:
    groups = defaultdict(dict)
    for example in examples:
        sentence = words(example.original)
        for fix in example.corrections:
            if fix.category != category:
                continue
            before, after = words(fix.original), words(fix.suggestion)
            target = None if category == "tense" else target_from_edit(category, before, after)
            if target is None and before:
                positions = [index for index in range(len(sentence)) if sentence[index:index + len(before)] == before]
                if len(positions) == 1:
                    index = positions[0]
                    corrected = sentence[:index] + after + sentence[index + len(before):]
                    target = target_from_edit(category, sentence, corrected)
            if target is not None:
                group = (target.kind, target.context, target.form if target.kind in {"fixed_preposition", "expression"} else "")
                key = (example.session_id, example.turn_index)
                evidence, targets = groups[group].setdefault(key, (example.model_copy(update={"corrections": []}), []))
                evidence.corrections.append(fix)
                targets.append(target)
    if not groups:
        return [], []
    best = max(groups.values(), key=lambda group: len({session for session, _ in group}))
    return [example for example, _ in best.values()], list(dict.fromkeys(target for _, targets in best.values() for target in targets))


def target_summary(target: PracticeTarget, example: CoachingExample) -> str:
    fix = example.corrections[0]
    rules = {
        "past": "说已经完成的过去动作时，用一般过去式。",
        "perfect": "说截至现在的经历，或从过去持续到现在的事，可以用 have 或 has 加过去分词。",
        "indefinite": "第一次提到一个未特指的可数事物时，用 a 或 an 引出它。按后面那个词的起始音来选。",
        "article_sound": "按冠词后面那个词的起始音来选。辅音音开头用 a，元音音开头用 an。",
        "definite": "双方已经知道你指的是哪一个时，可以用 the 指明它。",
        "bare_plural": "泛指一类可数事物时，可以直接用复数名词。",
        "bare_mass": "泛指这种不可数事物时，可以直接用名词。",
        "agreement": "先找主语，再选和它一致的动词形式。",
        "embedded_question": "把疑问放进 Could you tell me 或 Do you know 后面时，里面的主语放在 be 动词前。",
        "reason": "先把事情说完整，再用 because 接上有主语和动词的原因。",
        "time_preposition": {"day": "星期几或具体日期前用 on。", "clock": "具体几点前用 at。",
                             "period": "月份、年份和一天中的时段可以用 in。"}.get(target.context, target.instruction),
        "fixed_preposition": f"把 {target.form} 连起来记，再换一个对象试着说。",
        "expression": f"把 {target.form} 当成一组搭配，在新情境里试着用一次。",
    }
    return f"你这句里的「{fix.original[:70]}」改成了「{fix.suggestion[:70]}」。{rules[target.kind]}"
