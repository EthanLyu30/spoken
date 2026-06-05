"""Server-side scenario catalogue.

This module is the single source of truth for practice scenarios. The public
fields are exposed through the scenarios API and mirror the cards shown on the
web client; the dialogue fields (``partner_role`` / ``opening_line`` /
``persona``) drive the DeepSeek role-play and are used to build the system
prompt (see ``app.services.dialogue``).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.scenario import ScenarioPublic


@dataclass(frozen=True)
class ScenarioDef:
    id: str
    slug: str
    title: str
    title_zh: str
    category: str
    category_zh: str
    subtitle: str
    goal: str
    difficulty: int
    minutes: int
    icon: str
    # --- dialogue / role-play (internal) ---
    partner_role: str
    opening_line: str
    persona: str

    def public(self) -> ScenarioPublic:
        """Project to the client-facing schema (drops ``persona``)."""
        return ScenarioPublic(
            id=self.id,
            slug=self.slug,
            title=self.title,
            title_zh=self.title_zh,
            category=self.category,
            category_zh=self.category_zh,
            subtitle=self.subtitle,
            goal=self.goal,
            difficulty=self.difficulty,
            minutes=self.minutes,
            icon=self.icon,
            partner_role=self.partner_role,
            opening_line=self.opening_line,
        )


SCENARIOS: list[ScenarioDef] = [
    ScenarioDef(
        id="interview",
        slug="job-interview",
        title="The Job Interview",
        title_zh="求职面试",
        category="Interview",
        category_zh="面试",
        subtitle="和一位友好的招聘经理聊聊你的经历与优势",
        goal="Walk a hiring manager through your experience, handle follow-ups, and close with a question of your own.",
        difficulty=4,
        minutes=8,
        icon="Briefcase",
        partner_role="Alex, a friendly but professional hiring manager",
        opening_line=(
            "Hi, thanks for coming in today! I'm Alex, I'll be running our chat. "
            "To get started, could you tell me a little about yourself?"
        ),
        persona=(
            "You are Alex, interviewing the learner for a role they are interested in. "
            "Ask about their background and recent experience, ask one natural follow-up "
            "to something they say, then a light behavioural question (for example a "
            "challenge they handled). Near the end, invite them to ask you a question. "
            "Stay warm and encouraging."
        ),
    ),
    ScenarioDef(
        id="cafe",
        slug="ordering-at-a-cafe",
        title="Ordering at a Café",
        title_zh="咖啡馆点单",
        category="Dining",
        category_zh="点餐",
        subtitle="点一杯咖啡和早午餐，应对加料与结账",
        goal="Order a drink and brunch, customise it, and settle the bill.",
        difficulty=1,
        minutes=4,
        icon="Coffee",
        partner_role="a cheerful café barista",
        opening_line="Hi there, welcome in! What can I get started for you today?",
        persona=(
            "You are a cheerful barista at a small coffee shop. Help the learner order a "
            "drink and maybe a snack. Offer simple choices (size, milk, for here or to go), "
            "suggest a pastry, then give them an easy total and wish them a good day. "
            "Keep it light and quick."
        ),
    ),
    ScenarioDef(
        id="standup",
        slug="the-team-standup",
        title="The Team Standup",
        title_zh="团队站会",
        category="Meeting",
        category_zh="会议",
        subtitle="汇报进度、说明阻塞点并对齐今日计划",
        goal="Give a crisp status update and align on blockers.",
        difficulty=3,
        minutes=6,
        icon="Users",
        partner_role="Sam, a supportive teammate running the daily standup",
        opening_line="Morning! Let's keep it short and sweet. What did you work on yesterday?",
        persona=(
            "You are Sam, a friendly teammate running a short daily standup. Ask what they "
            "did yesterday, what they plan to do today, and whether anything is blocking "
            "them. React briefly and naturally, and help them phrase blockers clearly. "
            "Keep the whole thing brisk."
        ),
    ),
    ScenarioDef(
        id="airport",
        slug="airport-check-in",
        title="Airport Check-in",
        title_zh="机场值机",
        category="Travel",
        category_zh="出行",
        subtitle="办理登机、托运行李并确认登机口",
        goal="Check in, check a bag, and confirm your gate.",
        difficulty=2,
        minutes=5,
        icon="Plane",
        partner_role="an airline check-in agent",
        opening_line="Good morning! May I see your passport, please? And where are you flying to today?",
        persona=(
            "You are an airline check-in agent. Greet them, ask for their passport and "
            "destination, ask whether they are checking any bags, then tell them the gate "
            "and boarding time and hand back a boarding pass. Be efficient and polite."
        ),
    ),
    ScenarioDef(
        id="doctor",
        slug="doctors-visit",
        title="A Doctor's Visit",
        title_zh="看医生",
        category="Health",
        category_zh="就医",
        subtitle="描述症状、回答问诊并预约复诊",
        goal="Describe symptoms and understand the advice you're given.",
        difficulty=3,
        minutes=6,
        icon="Stethoscope",
        partner_role="Dr. Lee, a kind general practitioner",
        opening_line="Hello, come on in and take a seat. So, what brings you in today?",
        persona=(
            "You are Dr. Lee, a kind general practitioner. Ask what brings them in, then a "
            "few simple follow-up questions about their symptoms (how long, how bad), and "
            "give gentle everyday advice, suggesting a follow-up if needed. Avoid heavy "
            "medical jargon."
        ),
    ),
    ScenarioDef(
        id="party",
        slug="small-talk-at-a-party",
        title="Small Talk at a Party",
        title_zh="派对寒暄",
        category="Social",
        category_zh="社交",
        subtitle="破冰、闲聊兴趣爱好并礼貌地结束对话",
        goal="Break the ice, find common ground, and exit gracefully.",
        difficulty=2,
        minutes=5,
        icon="PartyPopper",
        partner_role="Sam, a friendly fellow guest at a party",
        opening_line=(
            "Hey! I don't think we've met yet — I'm Sam, a friend of the host. "
            "How do you know everyone here?"
        ),
        persona=(
            "You are Sam, a relaxed, friendly guest at a houseparty. Make small talk: how "
            "they know the host, what they do, hobbies or weekend plans. Find common ground "
            "and keep it light. Don't interrogate — share a little about yourself too."
        ),
    ),
]

_BY_ID: dict[str, ScenarioDef] = {s.id: s for s in SCENARIOS}


def get_scenario(scenario_id: str) -> ScenarioDef | None:
    """Return the full scenario definition (including persona) or ``None``."""
    return _BY_ID.get(scenario_id)


def list_public() -> list[ScenarioPublic]:
    """All scenarios as client-facing payloads, in catalogue order."""
    return [s.public() for s in SCENARIOS]


def get_public(scenario_id: str) -> ScenarioPublic | None:
    """A single client-facing scenario payload, or ``None`` if unknown."""
    scenario = _BY_ID.get(scenario_id)
    return scenario.public() if scenario else None
