"""Reviewed, topic-coherent video and ETS interview practice.

The versioned Inspire JSON is the only source for the video collection. Invalid
or missing series data is an error, never a reason to silently serve ETS sets.
"""
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

INSPIRE_DATA_PATH = Path(__file__).with_name("inspire_interviews.json")
INSPIRE_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLfNWEZJODl5iNLcLDJX27jebB_psDCPec"


@dataclass(frozen=True)
class InterviewSet:
    id: str
    topic: str
    topic_en: str
    intro: str
    questions: tuple[str, ...]
    hints: tuple[str, ...]
    source_title: str
    source_url: str
    source_kind: str = "official_adapted"
    reviewed_at: str = "2026-10-28"
    collection: Literal["inspire", "ets"] = "ets"
    episode: int | None = None


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def _reviewed_date(value: object, field: str) -> str:
    value = _text(value, field)
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("not an ISO date")
    except ValueError as exc:
        raise ValueError(f"{field} must be a YYYY-MM-DD date") from exc
    return value


def _youtube_video_url(value: object, field: str) -> str:
    value = _text(value, field)
    try:
        url = urlsplit(value)
        video_id = ""
        if url.scheme == "https" and url.netloc in {"youtube.com", "www.youtube.com"} and url.path == "/watch":
            videos = parse_qs(url.query).get("v", [])
            if len(videos) == 1:
                video_id = videos[0]
        elif url.scheme == "https" and url.netloc == "youtu.be":
            video_id = url.path.removeprefix("/")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError("invalid video URL")
    except ValueError as exc:
        raise ValueError(f"{field} must be an HTTPS YouTube video URL") from exc
    return value


def load_inspire_sets(path: Path | None = None) -> tuple[InterviewSet, ...]:
    """Load every reviewed episode, failing clearly on malformed source data."""
    source = INSPIRE_DATA_PATH if path is None else path
    document = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("Inspire data must be an object")
    if document.get("playlist_url") != INSPIRE_PLAYLIST_URL:
        raise ValueError("playlist_url must identify the reviewed Inspire playlist")
    _reviewed_date(document.get("reviewed_at"), "reviewed_at")
    rows = document.get("sets")
    if not isinstance(rows, list) or not rows:
        raise ValueError("sets must be a nonempty list")

    groups = []
    ids: set[str] = set()
    episodes: set[int] = set()
    for index, row in enumerate(rows):
        prefix = f"sets[{index}]"
        if not isinstance(row, dict):
            raise ValueError(f"{prefix} must be an object")
        episode = row.get("episode")
        if type(episode) is not int or episode < 1:
            raise ValueError(f"{prefix}.episode must be a positive integer")
        identifier = _text(row.get("id"), f"{prefix}.id")
        if identifier in ids or episode in episodes:
            raise ValueError(f"{prefix} contains a duplicate id or episode")
        expected_id = "inspire-writing-190" if episode == 190 else f"inspire-{episode}"
        if identifier != expected_id:
            raise ValueError(f"{prefix}.id must match episode {episode}: {expected_id}")

        text_fields = {
            name: _text(row.get(name), f"{prefix}.{name}")
            for name in ("topic", "topic_en", "intro", "source_title")
        }
        sequences = {}
        for name in ("questions", "hints"):
            values = row.get(name)
            if not isinstance(values, list) or len(values) != 4:
                raise ValueError(f"{prefix}.{name} must contain exactly four strings")
            sequences[name] = tuple(_text(value, f"{prefix}.{name}[{i}]") for i, value in enumerate(values))
        if len({question.strip() for question in sequences["questions"]}) != 4:
            raise ValueError(f"{prefix}.questions must contain four distinct questions")
        if row.get("source_kind") != "video_adapted":
            raise ValueError(f"{prefix}.source_kind must be video_adapted")

        groups.append(InterviewSet(
            id=identifier, episode=episode, collection="inspire",
            **text_fields, **sequences,
            source_url=_youtube_video_url(row.get("source_url"), f"{prefix}.source_url"),
            source_kind="video_adapted",
            reviewed_at=_reviewed_date(row.get("reviewed_at"), f"{prefix}.reviewed_at"),
        ))
        ids.add(identifier)
        episodes.add(episode)
    return tuple(groups)


def get_interview_sets() -> tuple[InterviewSet, ...]:
    """Read on demand so a missing file never becomes a cached fallback."""
    return (*load_inspire_sets(), *ETS_INTERVIEW_SETS)


def _ets(test: int) -> str:
    return f"https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-{test}.pdf"

ETS_INTERVIEW_SETS = (
    InterviewSet(
        "work-life-balance", "工作与生活", "Work–life balance",
        "You are taking part in a research interview about balancing work and personal life.",
        (
            "What do you do to keep work or study from taking over your personal life? Describe a strategy that works for you.",
            "Would a company's support for a balanced lifestyle influence your decision to work there? Explain your reasons.",
            "Should employers offer flexible schedules or remote work even when they worry about reduced engagement? Why?",
            "How might people's priorities between work and personal life change in the future? What could drive that change?",
        ),
        ("选一个具体做法，再说它怎样帮到你。", "先表态，再结合择业需求举例。", "说明收益，再回应对效率的担忧。", "预测一个变化，并解释原因。"),
        "ETS Teacher Resources · Practice Test 1（改编）", _ets(1),
    ),
    InterviewSet(
        "exercise-habits", "运动与健康", "Exercise habits",
        "A researcher is interviewing you about exercise habits and fitness choices.",
        (
            "Describe an exercise that you or someone you know does regularly. What makes that activity a good choice?",
            "Would you rather exercise on your own or with other people? Explain what you enjoy about your choice.",
            "Is exercising outside better than exercising inside? Explain your opinion with an example.",
            "Can smartphone fitness apps help people maintain their exercise goals? Why might they work or fail?",
        ),
        ("运动种类 → 频率 → 一个好处。", "选择一种，再用个人经历支撑。", "考虑环境、便利或坚持的难度。", "举一个功能，并说明它怎样影响习惯。"),
        "ETS Teacher Resources · Practice Test 2（改编）", _ets(2),
    ),
    InterviewSet(
        "career-choices", "职业选择", "Career choices",
        "You have joined a research interview about choosing careers and changes in working life.",
        (
            "What career paths are common among people you know? Describe an example and why that path appeals to them.",
            "When choosing a career, would you put enjoyment of the work or income first? Explain your priorities.",
            "What are the benefits and drawbacks of moving between several careers instead of staying in one profession?",
            "How do you think artificial intelligence could change opportunities in a field you might work in? Give reasons.",
        ),
        ("熟悉的职业 → 具体的人或经历。", "明确优先项，同时解释另一项的作用。", "先说明总体看法，再谈一个得失。", "选择一个职业，说明工作任务会怎样变化。"),
        "ETS Teacher Resources · Practice Test 3（改编）", _ets(3),
    ),
    InterviewSet(
        "food-preferences", "饮食与文化", "Food preferences",
        "A researcher wants to learn about your food choices and the role of meals in everyday life.",
        (
            "What kinds of meals are popular among people your age? Explain what makes those meals appealing.",
            "On a busy day, how do you usually get your meals? Describe a typical choice and the reason for it.",
            "Do people have healthier eating habits now than in the past? Explain your view with an example.",
            "How important is cooking traditional dishes for maintaining a connection with one's culture? Can other activities play a similar role?",
        ),
        ("选一类食物，说明受欢迎的原因。", "给出真实的一天，而不是罗列全部选项。", "围绕一个变化比较过去和现在。", "说明食物的文化意义，再考虑其他方式。"),
        "ETS Teacher Resources · Practice Test 4（改编）", _ets(4),
    ),
    InterviewSet(
        "urban-life", "城市生活", "Urban life",
        "You are being interviewed for a research project about life in cities.",
        (
            "Think of a city you visited rather than lived in. What took you there, and what did you enjoy about the visit?",
            "Do cities usually make you feel energized or overwhelmed? Explain what contributes to that feeling.",
            "Does living in a city necessarily make someone's life more interesting? Discuss opportunities or experiences that support your view.",
            "Should city governments invest in additional parks to improve residents' happiness? Explain the benefits and possible trade-offs.",
        ),
        ("一次旅行 → 原因 → 印象最深的一点。", "一个感受，配合具体场景。", "表态后谈工作、文化或休闲机会。", "说明绿地的作用，兼顾投入与其他需求。"),
        "ETS · Updated Test at a Glance（改编）",
        "https://www.ets.org/pdfs/toefl/toefl-ibt-test-at-a-glance.pdf",
    ),
)


def __getattr__(name: str):
    # Keep older import users working without loading a not-yet-created file
    # while importing the app. Both names always resolve the full validated bank.
    if name == "INTERVIEW_SETS":
        return list(get_interview_sets())
    if name == "INDEPENDENT_QUESTIONS":
        return [question for group in get_interview_sets() for question in group.questions]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
