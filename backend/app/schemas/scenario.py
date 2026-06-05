"""Public scenario schema returned by the scenarios API.

Only presentation + scene-setup fields are exposed here. The internal role-play
guidance (``persona``) that steers the model lives in ``app.data.scenarios`` and
is never serialised to clients.
"""

from pydantic import BaseModel


class ScenarioPublic(BaseModel):
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
    # Who the AI partner plays + the line it opens the scene with.
    partner_role: str
    opening_line: str
