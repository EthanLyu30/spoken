"""Reviewed, topic-coherent practice for the post-January-2026 interview task.

Prompts are concise adaptations of linked public ETS samples, not recalled
live exam questions. Each set preserves the experience-to-opinion progression.
"""
from dataclasses import dataclass

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

def _ets(test: int) -> str:
    return f"https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-{test}.pdf"

INTERVIEW_SETS = [
    InterviewSet(
        "inspire-writing-190", "写作与表达", "Writing and expression",
        "You are taking part in an interview about writing in everyday life and education.",
        (
            "What do you usually write in daily life, and what purpose does that writing serve for you?",
            "Do you find it more helpful to outline a piece before writing, or to start straight away? Explain your preference.",
            "Should society protect the ability to write longer pieces, or place greater emphasis on brief digital messages? Why?",
            "Would requiring creative writing in every student's general education be a good idea? Explain your view.",
        ),
        ("写什么 → 为什么写 → 帮助你解决了什么。", "选一种方法，再举一个具体写作场景。", "比较两种表达的用途，给出自己的侧重。", "表态后考虑不同专业学生的需要。"),
        "Inspire SpeakEasy · Interview Practice #190（改编）",
        "https://www.youtube.com/watch?v=SCGP0s0UmHE",
        source_kind="video_adapted",
    ),
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
]
# Retain the old import for integrations; the API samples a whole set now.
INDEPENDENT_QUESTIONS = [q for group in INTERVIEW_SETS for q in group.questions]
