"""Server-side scenario catalogue.

This module is the single source of truth for practice scenarios. The public
fields are exposed through the scenarios API and mirror the cards shown on the
web client; the dialogue fields (``partner_role`` / ``opening_line`` /
``persona``) drive the DeepSeek role-play and are used to build the system
prompt (see ``app.services.dialogue``).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.custom import CustomScene
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
    ScenarioDef(
        id="restaurant",
        slug="dinner-reservation",
        title="Dinner Reservation",
        title_zh="餐厅订位点餐",
        category="Dining",
        category_zh="餐饮",
        subtitle="订位、看菜单、点一顿正式晚餐",
        goal="Get a table, order a full meal, and ask about the dishes.",
        difficulty=2,
        minutes=6,
        icon="UtensilsCrossed",
        partner_role="a warm restaurant waiter",
        opening_line="Good evening, welcome! Do you have a reservation with us tonight?",
        persona=(
            "You are a warm waiter at a sit-down restaurant. Seat them, walk them through "
            "the menu, take their order, suggest a dish, and check back. Keep it polite."
        ),
    ),
    ScenarioDef(
        id="shopping",
        slug="shopping-and-returns",
        title="Shopping & Returns",
        title_zh="购物与退换",
        category="Shopping",
        category_zh="购物",
        subtitle="试穿、比价、退换商品",
        goal="Find an item, ask about size and price, and handle a return.",
        difficulty=2,
        minutes=5,
        icon="ShoppingBag",
        partner_role="a helpful shop assistant",
        opening_line="Hi there! Let me know if you need a hand finding anything.",
        persona=(
            "You are a helpful clothing-shop assistant. Help them find an item, offer sizes "
            "and colours, mention price, and handle a return or exchange politely."
        ),
    ),
    ScenarioDef(
        id="hotel",
        slug="hotel-check-in",
        title="Hotel Check-in",
        title_zh="酒店入住",
        category="Travel",
        category_zh="出行",
        subtitle="办理入住、问设施、解决房间问题",
        goal="Check in, ask about amenities, and sort out a room request.",
        difficulty=2,
        minutes=5,
        icon="Hotel",
        partner_role="a courteous hotel front-desk clerk",
        opening_line="Good evening, welcome! Checking in? May I have your name, please?",
        persona=(
            "You are a courteous hotel front-desk clerk. Check them in, explain breakfast, "
            "wifi and checkout, and help with a small request or issue. Be efficient and kind."
        ),
    ),
    ScenarioDef(
        id="directions",
        slug="asking-directions",
        title="Asking Directions",
        title_zh="街头问路",
        category="Travel",
        category_zh="出行",
        subtitle="向路人问路、听懂指引",
        goal="Ask how to get somewhere and confirm the route.",
        difficulty=1,
        minutes=4,
        icon="MapPin",
        partner_role="a friendly local on the street",
        opening_line="Oh, hello! You look a little lost — need some help?",
        persona=(
            "You are a friendly local. Give clear, simple directions with turns, landmarks "
            "and rough time, then check they understood. Keep it warm and brief."
        ),
    ),
    ScenarioDef(
        id="presentation",
        slug="presentation-qa",
        title="Presentation Q&A",
        title_zh="汇报答疑",
        category="Work",
        category_zh="职场",
        subtitle="做完汇报后回答听众提问",
        goal="Field questions about your presentation clearly and confidently.",
        difficulty=4,
        minutes=7,
        icon="Presentation",
        partner_role="a curious colleague in the audience",
        opening_line="Thanks for the presentation! I've got a couple of questions, if that's okay.",
        persona=(
            "You are an engaged colleague asking follow-ups about the learner's presentation. "
            "Ask two or three clear questions (data, next steps, a challenge), react to answers, "
            "and stay supportive."
        ),
    ),
    ScenarioDef(
        id="networking",
        slug="networking-event",
        title="Networking Event",
        title_zh="职场社交",
        category="Work",
        category_zh="职场",
        subtitle="在活动上认识同行、交换联系",
        goal="Introduce yourself, find common ground, and swap contacts.",
        difficulty=3,
        minutes=6,
        icon="Handshake",
        partner_role="a friendly fellow attendee",
        opening_line="Hi there! Great session, wasn't it? So what brings you to the event?",
        persona=(
            "You are a friendly professional at a networking event. Make small talk, ask what "
            "they do, find common ground, and naturally move toward swapping contacts."
        ),
    ),
    ScenarioDef(
        id="phone",
        slug="customer-service-call",
        title="Customer Service Call",
        title_zh="客服来电",
        category="Services",
        category_zh="服务",
        subtitle="电话咨询 / 投诉、解决问题",
        goal="Explain a problem on the phone and get it resolved.",
        difficulty=3,
        minutes=6,
        icon="Headphones",
        partner_role="a patient customer-service rep named Jamie",
        opening_line="Thanks for calling support, this is Jamie. How can I help you today?",
        persona=(
            "You are a patient phone support rep. Ask for details, empathise, and walk them to "
            "a solution (refund, fix or booking). Keep it calm and clear."
        ),
    ),
    ScenarioDef(
        id="friend",
        slug="catching-up",
        title="Catching Up",
        title_zh="和朋友闲聊",
        category="Social",
        category_zh="社交",
        subtitle="和好友聊近况、约周末",
        goal="Catch up with a friend and make weekend plans.",
        difficulty=1,
        minutes=5,
        icon="MessageCircle",
        partner_role="the learner's close, upbeat friend",
        opening_line="Heyyy! It's been ages! How have you been?",
        persona=(
            "You are the learner's close, upbeat friend. Catch up casually, share a little "
            "about yourself, react warmly, and make a fun weekend plan together."
        ),
    ),
]

_BY_ID: dict[str, ScenarioDef] = {s.id: s for s in SCENARIOS}


def get_scenario(scenario_id: str) -> ScenarioDef | None:
    """Return the full scenario definition (including persona) or ``None``."""
    return _BY_ID.get(scenario_id)


def scene_from_custom(custom: CustomScene) -> ScenarioDef:
    """Wrap a user-defined scene as a transient ``ScenarioDef``.

    This lets the normal role-play / feedback code paths run on a scenario that
    is not in the catalogue (it never gets registered in ``_BY_ID``).
    """
    return ScenarioDef(
        id="custom",
        slug="custom",
        title=custom.title,
        title_zh=custom.title_zh or custom.title,
        category="Custom",
        category_zh="自定义",
        subtitle=custom.title_zh or custom.title,
        goal=custom.goal,
        difficulty=2,
        minutes=5,
        icon="MessageCircle",
        partner_role=custom.partner_role,
        opening_line=custom.opening_line,
        persona=custom.persona,
    )


def list_public() -> list[ScenarioPublic]:
    """All scenarios as client-facing payloads, in catalogue order."""
    return [s.public() for s in SCENARIOS]


def get_public(scenario_id: str) -> ScenarioPublic | None:
    """A single client-facing scenario payload, or ``None`` if unknown."""
    scenario = _BY_ID.get(scenario_id)
    return scenario.public() if scenario else None


# Each scenario gets a native-English voice + prosody (speed/pitch 0-100,
# 50 = neutral) so the emotion fits the scene: lively for friends/parties,
# calm for the doctor, measured for an interview, etc.
DEFAULT_VOICE: dict[str, object] = {"vcn": "x5_enus_flossie_flow", "speed": 54, "pitch": 52}
_VOICES: dict[str, dict[str, object]] = {
    "interview": {"vcn": "henry", "speed": 52, "pitch": 50},
    "cafe": {"vcn": "x5_enus_flossie_flow", "speed": 56, "pitch": 54},
    "standup": {"vcn": "x4_enus_luna_formal", "speed": 55, "pitch": 52},
    "airport": {"vcn": "x4_enus_laura_education", "speed": 52, "pitch": 50},
    "doctor": {"vcn": "x3_enus_emma_assist", "speed": 46, "pitch": 48},
    "party": {"vcn": "x4_lindsey_formal", "speed": 60, "pitch": 56},
    "restaurant": {"vcn": "x4_lindsey_formal", "speed": 53, "pitch": 52},
    "shopping": {"vcn": "x3_enus_emma_assist", "speed": 55, "pitch": 53},
    "hotel": {"vcn": "x4_enus_laura_education", "speed": 51, "pitch": 50},
    "directions": {"vcn": "x5_enus_flossie_flow", "speed": 54, "pitch": 53},
    "presentation": {"vcn": "henry", "speed": 50, "pitch": 50},
    "networking": {"vcn": "x4_enus_luna_formal", "speed": 57, "pitch": 54},
    "phone": {"vcn": "x4_enus_luna_formal", "speed": 53, "pitch": 50},
    "friend": {"vcn": "x5_enus_flossie_flow", "speed": 60, "pitch": 56},
}


def voice_for(scenario_id: str | None) -> dict[str, object]:
    """Voice + prosody config for a scenario, or the default."""
    return _VOICES.get(scenario_id or "", DEFAULT_VOICE)
