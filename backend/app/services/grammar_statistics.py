"""Count distinct, grounded edits in the learner's recent saved conversations."""

import re
from bisect import bisect_left, bisect_right
from collections import defaultdict
from difflib import SequenceMatcher

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.models.session import PracticeSession, Turn
from app.schemas.coaching import CoachingExample, GrammarGroup, GrammarStatistics
from app.schemas.feedback import Correction
from app.services.coaching import article_edits
from app.services.coaching_targets import is_preposition_change, target_from_edit, target_spans, tense_pattern, words
from app.services.corrections import read_corrections

_SESSION_LIMIT = 50
_EXAMPLE_LIMIT = 5
_TOKENS = re.compile(r"[a-z]+(?:['-][a-z]+)*|\d+(?::\d+)?|[\u3400-\u9fff]+|[^\W\d_]+")
_SENTENCE_END = re.compile(r'''([.!?…]+)["'”’\)\]»]*(?=\s|$)|([。！？]+)["'”’\)\]»]*''')
_NONFINAL_ABBREVIATION = re.compile(r"\b(?:mr|mrs|ms|dr|prof|sr|jr|st|mt|rev|gen|sgt|lt|col|capt|vs|e\.g|i\.e)\.$", re.I)
_NUMBER_ABBREVIATION = re.compile(r"\b(?:fig|no)\.$", re.I)
_OTHER_ABBREVIATION = re.compile(r"\b(?:[a-z]\.){2,}$|\betc\.$", re.I)
_OBJECTS = {
    "make": {"reservation", "appointment", "decision", "mistake", "choice", "effort", "progress"},
    "take": {"photo", "picture", "break", "seat", "shower", "exam"},
    "do": {"homework", "laundry", "research", "dishes"},
    "pay": {"attention", "bill"},
    "place": {"order"},
}
_VERBS = {form: base for base, forms in {
    "make": "make makes made making", "take": "take takes took taken taking", "do": "do does did done doing",
    "pay": "pay pays paid paying", "place": "place places placed placing", "have": "have has had having",
    "give": "give gives gave given giving", "get": "get gets got gotten getting",
}.items() for form in forms.split()}
_DIRECT_OBJECT = {
    "about": {"discuss", "discusses", "discussed", "discussing"},
    "to": {"reach", "reaches", "reached", "reaching", "approach", "approaches", "approached", "approaching",
           "contact", "contacts", "contacted", "contacting"},
}
_DETERMINERS = {"a", "an", "the", "some", "this", "that", "my", "your", "his", "her", "our", "their"}
_CLOCK_FOLLOWERS = {"o'clock", "am", "pm", "sharp", "today", "tomorrow", "yesterday", "in", "on", "last",
                    "past", "to", "fifteen", "thirty", "forty", "and", "or"}


def _sentence_ends(line: str):
    """Yield sentence boundary offsets in the case-folded text used for matching."""
    folded_end = start = 0
    for match in _SENTENCE_END.finditer(line):
        if match[1] in {".", "...", "…"}:
            next_word = line[match.end():].lstrip()
            preceding = line[:match.end(1)]
            if next_word and (
                _NONFINAL_ABBREVIATION.search(preceding)
                or next_word[0].isdigit() and _NUMBER_ABBREVIATION.search(preceding)
                or next_word[0].islower() and (_OTHER_ABBREVIATION.search(preceding) or match[1] != ".")
            ):
                continue
        folded_end += len(line[start:match.end()].casefold())
        yield folded_end
        start = match.end()


class _LearnerLine:
    def __init__(self, line: str):
        line = " ".join(line.replace("’", "'").split())
        self.text = line.casefold()
        tokens = list(_TOKENS.finditer(self.text))
        self.words = tuple(token[0] for token in tokens)
        starts = [token.start() for token in tokens]
        self.starts = {start: index for index, start in enumerate(starts)}
        boundaries = (bisect_left(starts, end) for end in _sentence_ends(line))
        self.sentence_starts = sorted({0, *(index for index in boundaries if index < len(tokens))})
        self.sentence_ends = self.sentence_starts[1:] + [len(tokens)]

    def sentence_at(self, index: int) -> int:
        return bisect_right(self.sentence_starts, index) - 1

    def offsets(self, quote: str, words: tuple[str, ...]) -> list[int]:
        needle = " ".join(quote.split())
        first = _TOKENS.search(needle)
        if not first:
            return []
        return [index for match in re.finditer(rf"(?={re.escape(needle)})", self.text)
                if (index := self.starts.get(match.start() + first.start())) is not None
                and self.words[index:index + len(words)] == words]


def _verb_object(old, new, left, right):
    if len(old) == len(new) == 1 and right:
        verb, replacement = _VERBS.get(old[0]), _VERBS.get(new[0])
        noun = next((word for word in right if word not in _DETERMINERS), "")
        objects = _OBJECTS.get(replacement, ())
        if verb and verb != replacement and (noun in objects or noun.removesuffix("s") in objects):
            return "verb_object_collocation"
    if not new and len(old) == 1 and left and right and left[-1] in _DIRECT_OBJECT.get(old[0], ()):
        return "verb_object_structure"
    return None


def _classify(category, before, after, edits, source, offset):
    """Return one or more supported types with edit spans relative to the original quote."""
    if category == "articles":
        changes = [(kind, ((start, end),)) for kind, start, end, _, _ in article_edits(before, after)]
        if not after and len(changes) != len(before):
            return []  # A deletion of lexical content is broader than an article edit.
        return changes
    found = []
    if category in {"word_order", "sentence_structure"}:
        start = source.sentence_starts[source.sentence_at(offset)]
        end = source.sentence_ends[source.sentence_at(offset + len(before) - 1)]
        sentence = source.words[start:end]
        local_offset = offset - start
        corrected = sentence[:local_offset] + after + sentence[local_offset + len(before):]
        target = target_from_edit(category, sentence, corrected)
        if target and not any(target_spans(sentence, target)):
            for left_edge, right_edge in target_spans(corrected, target):
                spans = tuple((i, j) for i, j, k, l in edits if left_edge <= local_offset + k < right_edge
                              or local_offset + k < left_edge < local_offset + l)
                if spans:
                    found.append((target.kind, spans))
    structural = {span for _, spans in found for span in spans}
    for start, end, new_start, new_end in edits:
        if (start, end) in structural:
            continue
        old, new = before[start:end], after[new_start:new_end]
        first = source.sentence_at(offset + min(start, len(before) - 1))
        last = source.sentence_at(offset + min(max(start, end - 1), len(before) - 1))
        left = source.words[source.sentence_starts[first]:offset + start]
        right = source.words[offset + end:source.sentence_ends[last]]
        kind = None
        if category == "tense":
            kind = tense_pattern(old, new, words(" ".join(left)), right)
            if not kind and tense_pattern(old, new, (), right):
                kind = "tense"  # The verb changed, but its actual auxiliary rules out this subtype.
        elif category in {"prepositions", "word_choice", "sentence_structure"}:
            kind = _verb_object(old, new, left, right)
        if not kind and category == "word_choice" and len(old) == len(new) == 1 and old[0].isascii() and new[0].isascii():
            # An independent word substitution remains a recorded vocabulary edit,
            # even when a different part of this sentence has a known collocation.
            kind = "word_choice"
        if kind is None and category in {"agreement", "prepositions"}:
            target = target_from_edit(category, left + old + right, left + new + right)
            # A numeral followed by a noun (e.g. "at two stations") is a
            # quantity. Only label clock times when their context supports it.
            if target and (target.context != "clock" or len(right) < 2 or right[0] in {"noon", "midnight"}
                           or ":" in right[0] or right[1] in _CLOCK_FOLLOWERS or right[1:3] in {("a", "m"), ("p", "m")}):
                kind = target.kind
        if kind is None and category == "prepositions" and is_preposition_change(old, new):
            kind = "prepositions"
        if kind:
            found.append((kind, ((start, end),)))
    return found


def _practice_fix(fix, kind, spans, edits, quoted, replacements, multiple, source, offset):
    """Focus a multi-edit report on one saved change without inventing learner text."""
    if not multiple:
        return fix
    article = kind.startswith("article_")
    if article:
        # The noun can have a spelling correction in the same diff as its
        # article. The article matcher already aligns these noun phrases.
        changes = article_edits(tuple(token[0] for token in quoted), tuple(token[0] for token in replacements))
        edit = next((change[1:] for change in changes if change[0] == kind and change[1:3] == spans[0]), None)
    else:
        relevant = [edit for edit in edits if edit[:2] in spans]
        edit = (relevant[0][0], relevant[-1][1], relevant[0][2], relevant[-1][3]) if relevant else None
    if edit is None:
        return fix
    i, j, k, l = edit
    left, right = 0, len(quoted)
    if offset is not None:
        first = source.sentence_at(offset + min(i, len(quoted) - 1))
        last = source.sentence_at(offset + min(max(i, j - 1), len(quoted) - 1))
        left = max(left, source.sentence_starts[first] - offset)
        right = min(right, source.sentence_ends[last] - offset)
    if i == j or k == l or article:
        # Keep an added/removed article with its noun so both sides can be
        # located and practised, including corrections whose answer is empty.
        if kind == "verb_object_structure" and i > left and k and quoted[i - 1][0] == replacements[k - 1][0]:
            i -= 1
            k -= 1
        elif j < right and l < len(replacements) and (article or quoted[j][0] == replacements[l][0]):
            j += 1
            l += 1
        elif i > left and k and quoted[i - 1][0] == replacements[k - 1][0]:
            i -= 1
            k -= 1
    if i == j:
        return fix
    original, suggestion = fix.original.strip(), fix.suggestion.strip()
    if len(original.casefold()) != len(original) or len(suggestion.casefold()) != len(suggestion):
        return fix
    # Retain unchanged context when a uniquely located report would otherwise
    # become an ambiguous fragment after narrowing it to the selected edit.
    while offset is not None and len(source.offsets(
        original[quoted[i].start():quoted[j - 1].end()].casefold().replace("’", "'"),
        tuple(token[0] for token in quoted[i:j]),
    )) > 1:
        if j < right and l < len(replacements) and quoted[j][0] == replacements[l][0]:
            j += 1
            l += 1
        elif i > left and k and quoted[i - 1][0] == replacements[k - 1][0]:
            i -= 1
            k -= 1
        else:
            break
    return fix.model_copy(update={"original": original[quoted[i].start():quoted[j - 1].end()],
                                  "suggestion": suggestion[replacements[k].start():replacements[l - 1].end()]
                                  if k < l else ""})


def _distinct_edits(line: str, fixes: list[Correction]):
    source = _LearnerLine(line)
    evidence = []
    saved = []
    for fix in fixes:
        if fix.self_marked or not fix.category:
            continue
        quote = fix.original.strip().casefold().replace("’", "'")
        quoted = list(_TOKENS.finditer(quote))
        before = tuple(token[0] for token in quoted)
        replacements = list(_TOKENS.finditer(fix.suggestion.strip()[:2000].casefold().replace("’", "'")))
        after = tuple(token[0] for token in replacements)
        if not before or before == after or (not after and fix.suggestion != ""):
            continue
        offsets = source.offsets(quote, before)
        if not offsets:
            continue
        if fix not in saved:
            saved.append(fix)
        edits = [(i, j, k, l) for tag, i, j, k, l in SequenceMatcher(a=before, b=after, autojunk=False).get_opcodes()
                 if tag != "equal"]
        found = _classify(fix.category, before, after, edits, source, offsets[0])
        # A repeated fragment could occur in different grammatical contexts.
        if any(_classify(fix.category, before, after, edits, source, offset) != found for offset in offsets[1:]):
            found = []
        for kind, spans in found or [(fix.category, tuple((i, j) for i, j, _, _ in edits))]:
            alternatives = [tuple((offset + i, offset + j) for i, j in spans) for offset in offsets]
            focus = _practice_fix(fix, kind, spans, edits, quoted, replacements, len(found) > 1 or len(edits) > 1,
                                  source, offsets[0] if len(offsets) == 1 else None)
            sentences = {source.sentence_at(offset + min(spans[0][0], len(before) - 1)) for offset in offsets}
            evidence.append((len(offsets), kind == fix.category, len(quote), kind, alternatives, focus, sentences))

    # Prefer an identifiable type and a precisely located quote. A shorter repeated
    # fragment can corroborate any matching site, but cannot establish a second error.
    covered = set()
    distinct = []
    for _, _, _, kind, alternatives, focus, sentences in sorted(evidence, key=lambda item: item[:3]):
        if any((start, end) == (i, j) or (start < j and i < end) for spans in alternatives
               for start, end in spans for i, j in covered):
            continue
        covered.update(span for spans in alternatives for span in spans)
        distinct.append((kind, focus, sentences))
    return distinct, saved


def _recover_unindexed(db, turns_query, unindexed, by_session):
    matches = defaultdict(set)
    query = turns_query.where(Turn.role == "user", Turn.session_id.in_(unindexed)).execution_options(yield_per=200)
    for turn in db.execute(query):
        line = _LearnerLine(turn.content)
        for index, (_, quote, original) in enumerate(unindexed[turn.session_id]):
            matched = matches[turn.session_id, index]
            if len(matched) < 2 and line.offsets(quote, original):
                matched.add(turn.idx)
    for (session, entry), indexes in matches.items():
        if len(indexes) == 1:
            index, = indexes
            fix = unindexed[session][entry][0]
            by_session[session][index].append(fix.model_copy(update={"turn_index": index}))


def grammar_statistics(db: Session, owner: str) -> GrammarStatistics:
    sessions = db.execute(select(PracticeSession.id, PracticeSession.scenario_id, PracticeSession.corrections)
        .where(PracticeSession.client_id == owner)
        .order_by(PracticeSession.created_at.desc(), PracticeSession.id.desc()).limit(_SESSION_LIMIT)).all()
    by_session = {session_id: defaultdict(list) for session_id, _, _ in sessions}
    unindexed = defaultdict(list)
    for session_id, _, stored in sessions:
        for fix in read_corrections(stored, session_id):
            if not fix.category or fix.self_marked:
                continue
            # A damaged JSON record may contain an index outside the SQL INTEGER range.
            if fix.turn_index is None:
                quote = fix.original.strip().casefold().replace("’", "'")
                original = tuple(_TOKENS.findall(quote))
                if original:
                    unindexed[session_id].append((fix, quote, original))
            elif fix.turn_index < 2**31:
                by_session[session_id][fix.turn_index].append(fix)
    turns_query = (select(Turn.session_id, Turn.idx, Turn.role, Turn.content)
                   .join(PracticeSession, PracticeSession.id == Turn.session_id).where(PracticeSession.client_id == owner))
    if unindexed:
        _recover_unindexed(db, turns_query, unindexed, by_session)
    candidates = [(session_id, scene, index, by_session[session_id][index]) for session_id, scene, _ in sessions
                  for index in sorted(by_session[session_id], reverse=True)]
    refs = list({(session_id, i) for session_id, _, index, _ in candidates for i in (index, index - 1) if i >= 0})
    turns = {}
    # Two bound parameters per turn. Keep each query within SQLite's older 999-parameter limit.
    for offset in range(0, len(refs), 400):
        rows = db.execute(turns_query.where(tuple_(Turn.session_id, Turn.idx).in_(refs[offset:offset + 400])))
        turns.update(((row.session_id, row.idx), row) for row in rows)

    groups = {}
    for session_id, scene, index, fixes in candidates:
        turn = turns.get((session_id, index))
        if turn is None or turn.role != "user":
            continue
        findings, saved = _distinct_edits(turn.content, fixes)
        seen = defaultdict(set)
        for kind, focus, sentences in sorted(findings, key=lambda finding: len(finding[2])):
            if kind not in groups:
                groups[kind] = GrammarGroup(kind=kind, occurrences=0, sentences=0, examples=[])
            group = groups[kind]
            group.occurrences += 1
            if not seen[kind].isdisjoint(sentences):
                continue
            # A repeated quote proves an occurrence but may not identify its
            # sentence. Count one only when none of its sites is already represented.
            seen[kind].update(sentences)
            group.sentences += 1
            if len(group.examples) < _EXAMPLE_LIMIT:
                partner = turns.get((session_id, index - 1))
                group.examples.append(CoachingExample(session_id=session_id, scenario_id=scene, turn_index=index,
                    original=turn.content, previous_partner_message=partner.content if partner and partner.role == "assistant" else "",
                    corrections=[focus, *(other for other in saved if other != focus)]))
    ranked = sorted(groups.values(), key=lambda group: (-group.occurrences, -group.sentences, group.kind))
    return GrammarStatistics(sessions_analyzed=len(sessions), session_limit=_SESSION_LIMIT,
                             example_limit=_EXAMPLE_LIMIT, groups=ranked)
