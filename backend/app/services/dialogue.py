"""Turns a scenario + conversation history into a model message list.

The system prompt keeps the AI on the *fast path*: a natural, in-character
conversation partner with short, speakable replies. It deliberately does NOT
correct grammar or give feedback — that is the job of the slow assessment path
added in a later milestone.
"""

from __future__ import annotations

from app.data.scenarios import ScenarioDef
from app.schemas.chat import ChatMessage

_SYSTEM_TEMPLATE = """You are {partner_role} in a spoken role-play that helps a Chinese learner practise everyday English. Stay fully in character at all times, and never say or hint that you are an AI, a model, or a tutor.

How to speak:
- Use natural, friendly, everyday English at a clear, approachable level.
- Keep each reply short — usually one or two sentences, the way people really talk.
- Your reply will be read aloud by a speech engine, so write plain spoken words only: no lists, markdown, emoji, parentheses, or stage directions.
- End most turns with a single, simple question to keep the conversation moving.
- If the learner seems stuck or drifts off-topic, gently guide them back into the scene.

Do NOT correct their grammar, vocabulary, or pronunciation, and do not grade them or give study tips. Your only job right now is to be a natural conversation partner. (Feedback is handled separately after the session.)

The goal of this scene: {goal}

Scene details:
{persona}"""


def build_system_prompt(scenario: ScenarioDef) -> str:
    return _SYSTEM_TEMPLATE.format(
        partner_role=scenario.partner_role,
        goal=scenario.goal,
        persona=scenario.persona,
    )


def build_messages(
    scenario: ScenarioDef, history: list[ChatMessage]
) -> list[dict[str, str]]:
    """System prompt followed by the conversation so far."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(scenario)}
    ]
    messages.extend({"role": m.role, "content": m.content} for m in history)
    return messages
