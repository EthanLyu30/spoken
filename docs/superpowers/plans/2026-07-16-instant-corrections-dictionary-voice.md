# Instant Corrections, Dictionary, and Mobile Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-demand correction and pronunciation feedback to every learner turn, add click/selection dictionary lookup across learning surfaces, and make mobile read-aloud fall back to a continuous natural iFlytek voice when no English browser voice exists.

**Architecture:** Keep role-play chat unchanged and add separate correction and dictionary JSON endpoints backed by DeepSeek. Store voice PCM only in `Conversation` memory, render correction and pronunciation in isolated components, and replace the global selection-only collector with a dictionary provider plus reusable interactive English text. Resolve the read-aloud engine lazily for up to 500 ms, then use either a real English browser voice or a fixed cloud fallback; keep cloud synthesis as one PCM-to-WAV response and conservatively normalize only near-zero silence.

**Tech Stack:** FastAPI, Pydantic v2, DeepSeek JSON mode, iFlytek ISE/TTS, React 18, TypeScript, Zustand, Tailwind CSS, Vitest, React Testing Library, pytest.

## Global Constraints

- Corrections and dictionary lookups are user-triggered only; they must never block or alter Pip's role-play reply.
- `POST /api/turn-correction` accepts 1–600 trimmed characters and at most 600 characters of previous-partner context.
- `POST /api/dictionary/lookup` accepts an English query of at most 80 characters and at most 6 words.
- Original voice PCM stays only in browser memory, with PCM retained for at most the newest 8 learner turns and cleared on page exit.
- Typed turns never call pronunciation assessment; mixed turns assess only `spokenText` against that turn's PCM.
- Dictionary responses are cached in the backend for 24 hours with at most 512 entries and in the frontend for the current page session.
- Browser read-aloud waits no more than 500 ms for an English voice; otherwise it uses `x4_lindsey_formal`, speed `58`, and pitch `52`, unless the user supplied overrides.
- iFlytek TTS remains one raw-PCM synthesis request wrapped once as WAV; no word-level or MP3-fragment concatenation.
- New UI text uses the approved Chinese labels and renders model output as text, never HTML.
- Every production behavior is introduced by a failing test first; run the named focused test before implementation and again after implementation.
- Implementation happens on an isolated `codex/instant-corrections-dictionary-voice` branch/worktree; only merge and push to `main` after full verification.

## File Structure

### Backend

- `backend/app/schemas/turn_correction.py`: request/response contracts for one learner turn.
- `backend/app/services/turn_correction.py`: prompt construction and JSON parsing.
- `backend/app/api/turn_correction.py`: scenario resolution and HTTP error mapping.
- `backend/tests/test_turn_correction.py`: endpoint and parsing behavior.
- `backend/app/schemas/dictionary.py`: normalized dictionary request and response.
- `backend/app/services/dictionary.py`: DeepSeek lookup plus TTL/LRU cache.
- `backend/app/api/dictionary.py`: dictionary HTTP endpoint.
- `backend/tests/test_dictionary.py`: validation, output, cache hit, and expiry behavior.
- `backend/app/services/xf_tts.py`: conservative near-zero silence normalization.
- `backend/tests/test_tts.py`: waveform safety and WAV behavior.
- `backend/app/main.py`: register the two new routers.

### Frontend

- `frontend/src/lib/conversationTurns.ts`: pure learner-turn metadata and PCM-retention helpers.
- `frontend/src/lib/conversationTurns.test.ts`: metadata, mixed input, and eight-PCM retention tests.
- `frontend/src/components/PronunciationFeedback.tsx`: reusable pronunciation result UI.
- `frontend/src/components/TurnCorrectionCard.tsx`: on-demand text/pronunciation requests and actions.
- `frontend/src/components/TurnCorrectionCard.test.tsx`: typed, voice, mixed, and partial-failure behavior.
- `frontend/src/lib/clipboard.ts`: clipboard API with a hidden-textarea fallback.
- `frontend/src/lib/clipboard.test.ts`: fallback behavior.
- `frontend/src/components/ChatBubble.tsx`: focused assistant/user bubble rendering.
- `frontend/src/lib/dictionary.ts`: query normalization, session cache, in-flight de-duplication, and abortable subscribers.
- `frontend/src/lib/dictionary.test.ts`: cache and request-order behavior.
- `frontend/src/components/dictionary/DictionaryProvider.tsx`: selection listener, overlay state, focus return, and provider.
- `frontend/src/components/dictionary/DictionaryOverlay.tsx`: mobile bottom sheet and desktop anchored card.
- `frontend/src/components/dictionary/InteractiveEnglishText.tsx`: clickable word tokenization.
- `frontend/src/components/dictionary/InteractiveEnglishText.test.tsx`: punctuation, clicks, selection priority, and overlay integration.
- `frontend/src/lib/voiceResolver.ts`: deterministic browser/cloud engine resolution.
- `frontend/src/lib/voiceResolver.test.ts`: immediate voice, delayed voice, timeout, and overrides.
- `frontend/src/test/setup.ts`: jsdom matchers and browser API shims.
- `frontend/src/lib/api.ts`: correction, dictionary, and TTS override clients.
- `frontend/src/lib/speech.ts`: deferred engine choice for single lines and streaming queues.
- `frontend/src/lib/call.ts`: pass the current PCM into the reply callback when correction UI is wired.
- `frontend/src/pages/Conversation.tsx`: attach metadata, render correction cards, and preserve normal chat flow.
- `frontend/src/pages/Daily.tsx`, `frontend/src/pages/Report.tsx`, `frontend/src/pages/SessionView.tsx`: use interactive English text.
- `frontend/src/pages/Profile.tsx`: explain automatic cloud fallback when no English voice exists.
- `frontend/src/pages/WordBag.tsx`, `frontend/src/store/words.ts`: treat `phrase` as a word-list item.
- `frontend/src/App.tsx`: mount `DictionaryProvider`; remove `WordCollector`.
- `frontend/src/components/WordCollector.tsx`: delete after replacement.
- `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`: add the Vitest harness.

---

## Milestone A — Per-turn corrections and pronunciation

### Task 1: Add the turn-correction backend

**Files:**
- Create: `backend/app/schemas/turn_correction.py`
- Create: `backend/app/services/turn_correction.py`
- Create: `backend/app/api/turn_correction.py`
- Create: `backend/tests/test_turn_correction.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `DeepSeekClient.chat()`, catalogue/custom `ScenarioDef`, and the existing `get_client` dependency.
- Produces: `POST /api/turn-correction`, `TurnCorrectionRequest`, `TurnCorrectionResponse`, and `generate_turn_correction()`.

- [ ] **Step 1: Write endpoint tests that describe the complete response and error contract**

Create `backend/tests/test_turn_correction.py`:

```python
import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


class _Stub:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list[tuple[list[dict[str, str]], dict]] = []

    async def chat(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        return self.payload


def _body(**patch):
    body = {
        "scenario_id": "cafe",
        "text": "I very like this coffee",
        "previous_partner_message": "How do you like the coffee?",
    }
    body.update(patch)
    return body


def test_turn_correction_returns_structured_fix_and_context():
    stub = _Stub(
        json.dumps(
            {
                "natural": False,
                "suggestion": "I really like this coffee.",
                "issues": [
                    {
                        "kind": "grammar",
                        "original": "very like",
                        "replacement": "really like",
                        "note": "very 通常不直接修饰动词 like。",
                    }
                ],
                "explanation": "意思清楚，换一个副词会更自然。",
            }
        )
    )
    app.dependency_overrides[get_client] = lambda: stub
    try:
        response = client.post("/api/turn-correction", json=_body())
        assert response.status_code == 200
        body = response.json()
        assert body["original"] == "I very like this coffee"
        assert body["suggestion"] == "I really like this coffee."
        assert body["issues"][0]["kind"] == "grammar"
        prompt = stub.calls[0][0][1]["content"]
        assert "How do you like the coffee?" in prompt
        assert "Ordering at a Café" in prompt
        assert stub.calls[0][1]["response_format"] == {"type": "json_object"}
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_natural_sentence_has_no_issues():
    app.dependency_overrides[get_client] = lambda: _Stub(
        json.dumps(
            {
                "natural": True,
                "suggestion": "I'd like a latte, please.",
                "issues": [
                    {
                        "kind": "expression",
                        "original": "unused",
                        "replacement": "unused",
                        "note": "unused",
                    }
                ],
                "explanation": "表达自然，无需修改。",
            }
        )
    )
    try:
        response = client.post(
            "/api/turn-correction",
            json=_body(text="I'd like a latte, please."),
        )
        assert response.status_code == 200
        assert response.json()["natural"] is True
        assert response.json()["issues"] == []
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_validates_text_and_scenario():
    assert client.post("/api/turn-correction", json=_body(text="   ")).status_code == 422
    assert client.post("/api/turn-correction", json=_body(text="x" * 601)).status_code == 422
    assert client.post(
        "/api/turn-correction",
        json=_body(scenario_id="missing"),
    ).status_code == 404


def test_turn_correction_bad_model_json_maps_to_503():
    app.dependency_overrides[get_client] = lambda: _Stub("not json")
    try:
        assert client.post("/api/turn-correction", json=_body()).status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_service_failure_maps_to_503():
    class _Boom:
        async def chat(self, messages, **kwargs):
            raise DeepSeekError("down")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        assert client.post("/api/turn-correction", json=_body()).status_code == 503
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the focused tests and confirm the route is missing**

Run:

```powershell
cd backend
pytest tests/test_turn_correction.py -q
```

Expected: failures with `404 Not Found` for `/api/turn-correction`.

- [ ] **Step 3: Add the Pydantic contracts**

Create `backend/app/schemas/turn_correction.py`:

```python
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.custom import CustomScene


class TurnCorrectionIssue(BaseModel):
    kind: Literal["grammar", "expression"]
    original: str = Field(min_length=1, max_length=300)
    replacement: str = Field(min_length=1, max_length=300)
    note: str = Field(min_length=1, max_length=500)


class TurnCorrectionRequest(BaseModel):
    scenario_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=600)
    previous_partner_message: str = Field(default="", max_length=600)
    custom: CustomScene | None = None

    @field_validator("text")
    @classmethod
    def strip_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value

    @field_validator("previous_partner_message")
    @classmethod
    def strip_context(cls, value: str) -> str:
        return value.strip()


class TurnCorrectionResponse(BaseModel):
    original: str
    natural: bool
    suggestion: str = Field(min_length=1, max_length=800)
    issues: list[TurnCorrectionIssue] = Field(default_factory=list, max_length=6)
    explanation: str = Field(min_length=1, max_length=800)
```

- [ ] **Step 4: Add prompt construction and strict JSON parsing**

Create `backend/app/services/turn_correction.py`:

```python
from __future__ import annotations

import json

from pydantic import ValidationError

from app.data.scenarios import ScenarioDef
from app.schemas.turn_correction import (
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError

_SYSTEM = """You are a concise English coach for a Chinese learner.
Analyse only the learner's current sentence in the supplied role-play context.
Return one JSON object with exactly:
- natural: boolean
- suggestion: one complete natural English sentence the learner can say
- issues: 0-6 objects, each with kind ("grammar" or "expression"), original,
  replacement, and a brief Chinese note
- explanation: one brief encouraging Chinese summary

Do not invent an error. If the sentence is natural, set natural=true and issues=[].
Keep the learner's intended meaning. Do not answer the role-play partner."""


def build_turn_correction_messages(
    scenario: ScenarioDef,
    request: TurnCorrectionRequest,
) -> list[dict[str, str]]:
    context = request.previous_partner_message or "(no previous partner line)"
    user = (
        f"Scenario: {scenario.title} — {scenario.goal}\n"
        f"Partner's previous line: {context}\n"
        f"Learner's current sentence: {request.text}\n\n"
        "Return the correction JSON now."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


async def generate_turn_correction(
    scenario: ScenarioDef,
    request: TurnCorrectionRequest,
    client: DeepSeekClient,
) -> TurnCorrectionResponse:
    raw = await client.chat(
        build_turn_correction_messages(scenario, request),
        temperature=0.2,
        max_tokens=700,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(raw)
        data["original"] = request.text
        response = TurnCorrectionResponse(**data)
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise DeepSeekError(f"could not parse turn correction: {exc}") from exc
    if response.natural and response.issues:
        response = response.model_copy(update={"issues": []})
    return response
```

- [ ] **Step 5: Add the route and register it**

Create `backend/app/api/turn_correction.py`:

```python
from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.data import scenarios as catalog
from app.schemas.turn_correction import (
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.turn_correction import generate_turn_correction

router = APIRouter(tags=["turn-correction"])


@router.post("/turn-correction", response_model=TurnCorrectionResponse)
async def turn_correction(
    request: TurnCorrectionRequest,
    client: DeepSeekClient = Depends(get_client),
) -> TurnCorrectionResponse:
    if request.custom is not None:
        scenario = catalog.scene_from_custom(request.custom)
    else:
        scenario = catalog.get_scenario(request.scenario_id)
        if scenario is None:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown scenario: {request.scenario_id}",
            )
    try:
        return await generate_turn_correction(scenario, request, client)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
```

Modify `backend/app/main.py` to import `turn_correction` in the `app.api` tuple and add:

```python
app.include_router(turn_correction.router, prefix="/api")
```

Place it next to the existing feedback/hint routes.

- [ ] **Step 6: Run focused and neighboring backend tests**

Run:

```powershell
cd backend
pytest tests/test_turn_correction.py tests/test_feedback.py tests/test_hint.py -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit the backend correction endpoint**

```powershell
git add backend/app/api/turn_correction.py backend/app/schemas/turn_correction.py backend/app/services/turn_correction.py backend/app/main.py backend/tests/test_turn_correction.py
git commit -m "feat: add per-turn correction endpoint"
```

### Task 2: Add frontend test infrastructure and learner-turn metadata

**Files:**
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/lib/conversationTurns.ts`
- Create: `frontend/src/lib/conversationTurns.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `ChatMessage` and the PCM `ArrayBuffer` already produced by recorder/call mode.
- Produces: `UserTurnMeta`, `UserTurnMetaMap`, `appendUserTurn()`, and `previousPartnerMessage()`.

- [ ] **Step 1: Install and configure the frontend test runner**

Run from `frontend`:

```powershell
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add the script to `frontend/package.json`:

```json
"test": "vitest"
```

Change the first import of `frontend/vite.config.ts` to:

```ts
import { defineConfig } from "vitest/config";
```

Add this top-level property to `defineConfig({...})`:

```ts
test: {
  environment: "jsdom",
  setupFiles: "./src/test/setup.ts",
  css: true,
},
```

Create `frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
```

- [ ] **Step 2: Write failing tests for metadata attachment, context lookup, and PCM eviction**

Create `frontend/src/lib/conversationTurns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./api";
import {
  appendUserTurn,
  previousPartnerMessage,
  type UserTurnMetaMap,
} from "./conversationTurns";

describe("conversation turn metadata", () => {
  it("marks typed, voice, and mixed turns without putting PCM in messages", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "Hello!" }];
    const pcm = new ArrayBuffer(4);
    const result = appendUserTurn(messages, {}, "typed plus speech", {
      source: "mixed",
      spokenText: "speech",
      pcm,
    });

    expect(result.messages[1]).toEqual({
      role: "user",
      content: "typed plus speech",
    });
    expect(result.meta[1]).toMatchObject({
      source: "mixed",
      spokenText: "speech",
      pcm,
    });
    expect(result.messages).not.toContainEqual(expect.objectContaining({ pcm }));
  });

  it("keeps PCM for only the newest eight learner turns", () => {
    let messages: ChatMessage[] = [];
    let meta: UserTurnMetaMap = {};
    for (let index = 0; index < 9; index += 1) {
      const result = appendUserTurn(messages, meta, `turn ${index}`, {
        source: "voice",
        spokenText: `turn ${index}`,
        pcm: new ArrayBuffer(index + 1),
      });
      messages = result.messages;
      meta = result.meta;
    }

    expect(meta[0].source).toBe("voice");
    expect(meta[0].pcm).toBeUndefined();
    expect(Object.values(meta).filter((item) => item.pcm).length).toBe(8);
  });

  it("finds the closest earlier Pip message", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "First question" },
      { role: "user", content: "First answer" },
      { role: "assistant", content: "Follow-up" },
      { role: "user", content: "Second answer" },
    ];
    expect(previousPartnerMessage(messages, 3)).toBe("Follow-up");
    expect(previousPartnerMessage(messages, 0)).toBe("");
  });
});
```

- [ ] **Step 3: Run the metadata test and confirm the module is absent**

Run:

```powershell
cd frontend
npm run test -- --run src/lib/conversationTurns.test.ts
```

Expected: fail because `./conversationTurns` does not exist.

- [ ] **Step 4: Implement pure turn attachment and retention**

Create `frontend/src/lib/conversationTurns.ts`:

```ts
import type { ChatMessage } from "./api";

export type UserTurnSource = "typed" | "voice" | "mixed";

export interface UserTurnMeta {
  source: UserTurnSource;
  spokenText?: string;
  pcm?: ArrayBuffer;
}

export type UserTurnMetaMap = Record<number, UserTurnMeta>;

export interface AppendedUserTurn {
  messages: ChatMessage[];
  meta: UserTurnMetaMap;
  index: number;
}

const MAX_PCM_TURNS = 8;

export function appendUserTurn(
  messages: ChatMessage[],
  currentMeta: UserTurnMetaMap,
  text: string,
  turnMeta: UserTurnMeta,
): AppendedUserTurn {
  const index = messages.length;
  const meta: UserTurnMetaMap = {
    ...currentMeta,
    [index]: turnMeta,
  };
  const pcmIndexes = Object.keys(meta)
    .map(Number)
    .filter((key) => meta[key]?.pcm)
    .sort((a, b) => a - b);
  for (const oldIndex of pcmIndexes.slice(0, -MAX_PCM_TURNS)) {
    meta[oldIndex] = { ...meta[oldIndex], pcm: undefined };
  }
  return {
    messages: [...messages, { role: "user", content: text }],
    meta,
    index,
  };
}

export function previousPartnerMessage(
  messages: ChatMessage[],
  userIndex: number,
): string {
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index].content;
  }
  return "";
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```powershell
cd frontend
npm run test -- --run src/lib/conversationTurns.test.ts
npm run typecheck
```

Expected: metadata tests pass and typecheck exits 0.

- [ ] **Step 6: Commit the test harness and metadata helpers**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/setup.ts frontend/src/lib/conversationTurns.ts frontend/src/lib/conversationTurns.test.ts
git commit -m "test: add frontend turn metadata harness"
```

### Task 3: Render and wire on-demand correction cards

**Files:**
- Create: `frontend/src/components/PronunciationFeedback.tsx`
- Create: `frontend/src/components/TurnCorrectionCard.tsx`
- Create: `frontend/src/components/TurnCorrectionCard.test.tsx`
- Create: `frontend/src/components/ChatBubble.tsx`
- Create: `frontend/src/lib/clipboard.ts`
- Create: `frontend/src/lib/clipboard.test.ts`
- Modify: `frontend/src/components/PronounceButton.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/call.ts`
- Modify: `frontend/src/pages/Conversation.tsx`
- Test: `frontend/src/lib/conversationTurns.test.ts`

**Interfaces:**
- Consumes: `POST /api/turn-correction`, existing `postPronunciation()`, `UserTurnMeta`, and the previous partner message.
- Produces: `postTurnCorrection()`, `TurnCorrectionCard`, `PronunciationFeedback`, and a corrected `Conversation` flow for typed, voice, mixed, and call turns.

- [ ] **Step 1: Add failing component tests for typed, voice, mixed, and partial failure states**

Create `frontend/src/components/TurnCorrectionCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  postPronunciation,
  postTurnCorrection,
} from "../lib/api";
import { TurnCorrectionCard } from "./TurnCorrectionCard";

vi.mock("../lib/api", () => ({
  postTurnCorrection: vi.fn(),
  postPronunciation: vi.fn(),
}));

vi.mock("../lib/speech", () => ({
  speakText: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
}));

const correction = {
  original: "I very like it",
  natural: false,
  suggestion: "I really like it.",
  issues: [
    {
      kind: "grammar" as const,
      original: "very like",
      replacement: "really like",
      note: "用 really 修饰动词。",
    },
  ],
  explanation: "换一个副词会更自然。",
};

const pronunciation = {
  overall: 78,
  accuracy: 80,
  fluency: 76,
  integrity: 90,
  standard: 75,
  words: [{ word: "like", score: 62, phonemes: [{ label: "ay", ok: false }] }],
};

describe("TurnCorrectionCard", () => {
  beforeEach(() => {
    vi.mocked(postTurnCorrection).mockReset();
    vi.mocked(postPronunciation).mockReset();
    vi.mocked(postTurnCorrection).mockResolvedValue(correction);
    vi.mocked(postPronunciation).mockResolvedValue(pronunciation);
  });

  it("checks text only for a typed turn and caches the result", async () => {
    const user = userEvent.setup();
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage="How is it?"
        meta={{ source: "typed" }}
        onUseSuggestion={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    expect(await screen.findByText("I really like it.")).toBeInTheDocument();
    expect(screen.getByText("本句为文字输入，无法评测发音")).toBeInTheDocument();
    expect(postPronunciation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "收起即时纠错" }));
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    expect(postTurnCorrection).toHaveBeenCalledTimes(1);
  });

  it("checks text and pronunciation in parallel for a voice turn", async () => {
    const user = userEvent.setup();
    const pcm = new ArrayBuffer(8);
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage="How is it?"
        meta={{ source: "voice", spokenText: "I very like it", pcm }}
        onUseSuggestion={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    expect(await screen.findByText("发音参考")).toBeInTheDocument();
    expect(screen.getByText("78")).toBeInTheDocument();
    expect(postPronunciation).toHaveBeenCalledWith("I very like it", pcm);
  });

  it("assesses only spokenText for a mixed turn", async () => {
    const user = userEvent.setup();
    const pcm = new ArrayBuffer(8);
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="Could I get I very like it"
        previousPartnerMessage="What would you like?"
        meta={{ source: "mixed", spokenText: "I very like it", pcm }}
        onUseSuggestion={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    await screen.findByText("发音参考");
    expect(postTurnCorrection).toHaveBeenCalledWith({
      scenario_id: "cafe",
      text: "Could I get I very like it",
      previous_partner_message: "What would you like?",
      custom: undefined,
    });
    expect(postPronunciation).toHaveBeenCalledWith("I very like it", pcm);
  });

  it("keeps text correction visible when pronunciation fails", async () => {
    vi.mocked(postPronunciation).mockRejectedValue(new Error("ISE down"));
    const user = userEvent.setup();
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage=""
        meta={{
          source: "voice",
          spokenText: "I very like it",
          pcm: new ArrayBuffer(8),
        }}
        onUseSuggestion={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    expect(await screen.findByText("I really like it.")).toBeInTheDocument();
    expect(screen.getByText("发音评测失败，可单独重试")).toBeInTheDocument();
  });
});
```

Create `frontend/src/lib/clipboard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a hidden textarea when navigator.clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    await copyText("correct sentence");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the component test and confirm imports are missing**

Run:

```powershell
cd frontend
npm run test -- --run src/components/TurnCorrectionCard.test.tsx src/lib/clipboard.test.ts
```

Expected: fail because `TurnCorrectionCard`, `postTurnCorrection`, and `clipboard.ts` do not exist.

- [ ] **Step 3: Add correction types and API client**

In `frontend/src/lib/api.ts`, add:

```ts
export type CorrectionIssueKind = "grammar" | "expression";

export interface TurnCorrectionIssue {
  kind: CorrectionIssueKind;
  original: string;
  replacement: string;
  note: string;
}

export interface TurnCorrectionResponse {
  original: string;
  natural: boolean;
  suggestion: string;
  issues: TurnCorrectionIssue[];
  explanation: string;
}

export interface TurnCorrectionPayload {
  scenario_id: string;
  text: string;
  previous_partner_message: string;
  custom?: CustomScene;
}

export function postTurnCorrection(
  payload: TurnCorrectionPayload,
  signal?: AbortSignal,
): Promise<TurnCorrectionResponse> {
  return request<TurnCorrectionResponse>("/api/turn-correction", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}
```

- [ ] **Step 4: Extract reusable pronunciation rendering**

Create `frontend/src/components/PronunciationFeedback.tsx` by moving the result UI and `scoreColor()` out of `PronounceButton`. Export:

```tsx
import { useState } from "react";
import type { PronunciationResult } from "../lib/api";
import { cn } from "../lib/utils";

export function scoreColor(score: number): string {
  if (score >= 85) return "#2fa274";
  if (score >= 70) return "#e07f1c";
  return "#e6503d";
}

export function PronunciationFeedback({
  result,
  title = "发音参考",
}: {
  result: PronunciationResult;
  title?: string;
}) {
  const [openWord, setOpenWord] = useState<number | null>(null);
  return (
    <section className="mt-3 rounded-2xl bg-surface px-3 py-2 shadow-soft">
      <p className="text-[0.66rem] font-bold uppercase tracking-wide text-muted">
        {title}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="font-display text-lg font-bold tabnum"
          style={{ color: scoreColor(result.overall) }}
        >
          {Math.round(result.overall)}
        </span>
        <span className="text-[0.6rem] font-bold uppercase text-muted">/ 100</span>
        <span className="text-[0.62rem] text-muted">
          准确 {Math.round(result.accuracy)} · 流利 {Math.round(result.fluency)} ·
          完整 {Math.round(result.integrity)}
        </span>
      </div>
      {result.words.length > 0 && (
        <>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {result.words.map((word, index) => {
              const expandable = (word.phonemes?.length ?? 0) > 0;
              return (
                <button
                  key={`${word.word}-${index}`}
                  type="button"
                  onClick={() =>
                    expandable && setOpenWord(openWord === index ? null : index)
                  }
                  className={cn(
                    "text-sm font-semibold",
                    expandable && "underline decoration-dotted underline-offset-2",
                  )}
                  style={{ color: scoreColor(word.score) }}
                  aria-label={`${word.word}，${Math.round(word.score)} 分${
                    expandable ? "，查看音素" : ""
                  }`}
                >
                  {word.word}
                </button>
              );
            })}
          </p>
          {openWord !== null &&
            (result.words[openWord]?.phonemes?.length ?? 0) > 0 && (
              <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-[0.6rem] font-bold uppercase tracking-wide text-muted">
                  音素 · {result.words[openWord].word}
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {result.words[openWord].phonemes!.map((phoneme, index) => (
                    <span
                      key={`${phoneme.label}-${index}`}
                      className="rounded px-1.5 py-0.5 text-xs font-bold"
                      style={{
                        background: phoneme.ok ? "#e2f6ee" : "#ffe8e3",
                        color: phoneme.ok ? "#2fa274" : "#e6503d",
                      }}
                    >
                      {phoneme.label}
                    </span>
                  ))}
                </p>
                <p className="mt-1 text-[0.6rem] text-muted">
                  绿色=读准 · 红色=有偏差
                </p>
              </div>
            )}
        </>
      )}
    </section>
  );
}
```

Update `PronounceButton.tsx` to keep recording/loading/error logic and render:

```tsx
{result && <PronunciationFeedback result={result} title="跟读评分" />}
```

- [ ] **Step 5: Implement the independent correction card**

Create `frontend/src/lib/clipboard.ts`:

```ts
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}
```

Create `frontend/src/components/TurnCorrectionCard.tsx` with these exported props and state rules:

```tsx
import { useState } from "react";
import { Check, Copy, Loader2, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import {
  postPronunciation,
  postTurnCorrection,
  type CustomScene,
  type PronunciationResult,
  type TurnCorrectionResponse,
} from "../lib/api";
import { copyText } from "../lib/clipboard";
import { speakText } from "../lib/speech";
import type { UserTurnMeta } from "../lib/conversationTurns";
import { PronunciationFeedback } from "./PronunciationFeedback";

type LoadState<T> =
  | { status: "idle" | "loading" | "error"; data?: undefined }
  | { status: "ready"; data: T };

export interface TurnCorrectionCardProps {
  scenarioId: string;
  text: string;
  previousPartnerMessage: string;
  custom?: CustomScene;
  meta: UserTurnMeta;
  onUseSuggestion: (suggestion: string) => void;
}

export function TurnCorrectionCard(props: TurnCorrectionCardProps) {
  const [open, setOpen] = useState(false);
  const [textState, setTextState] =
    useState<LoadState<TurnCorrectionResponse>>({ status: "idle" });
  const [pronunciationState, setPronunciationState] =
    useState<LoadState<PronunciationResult>>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  const canAssessPronunciation = Boolean(props.meta.spokenText && props.meta.pcm);

  async function loadText(force = false) {
    if (!force && textState.status === "ready") return;
    setTextState({ status: "loading" });
    try {
      const data = await postTurnCorrection({
        scenario_id: props.scenarioId,
        text: props.text,
        previous_partner_message: props.previousPartnerMessage,
        custom: props.custom,
      });
      setTextState({ status: "ready", data });
    } catch {
      setTextState({ status: "error" });
    }
  }

  async function loadPronunciation(force = false) {
    if (!canAssessPronunciation) return;
    if (!force && pronunciationState.status === "ready") return;
    setPronunciationState({ status: "loading" });
    try {
      const data = await postPronunciation(
        props.meta.spokenText as string,
        props.meta.pcm as ArrayBuffer,
      );
      setPronunciationState({ status: "ready", data });
    } catch {
      setPronunciationState({ status: "error" });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void loadText();
      void loadPronunciation();
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "收起即时纠错" : "即时纠错"}
        className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-75 transition-opacity hover:opacity-100"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {open ? "收起纠错" : "即时纠错"}
      </button>
      {open && (
        <section className="mt-2 rounded-2xl bg-surface-2 p-3 text-ink shadow-soft">
          {textState.status === "loading" && (
            <p aria-live="polite" className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在分析语法和表达…
            </p>
          )}
          {textState.status === "error" && (
            <div role="alert" className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#e6503d]">纠错失败，请重试</span>
              <button type="button" onClick={() => void loadText(true)}>
                <RotateCcw className="h-3.5 w-3.5" /> 重试
              </button>
            </div>
          )}
          {textState.status === "ready" && (
            <>
              <p className="text-[0.62rem] font-bold uppercase text-muted">原句</p>
              <p className="text-sm">{textState.data.original}</p>
              <p className="mt-2 text-[0.62rem] font-bold uppercase text-leaf-deep">
                推荐表达
              </p>
              <p className="text-sm font-bold text-leaf-deep">
                {textState.data.suggestion}
              </p>
              {textState.data.natural ? (
                <p className="mt-2 text-xs text-muted">表达自然，无需修改。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {textState.data.issues.map((issue, index) => (
                    <li key={`${issue.kind}-${index}`} className="rounded-xl bg-surface p-2">
                      <p className="text-[0.62rem] font-bold text-coral-deep">
                        {issue.kind === "grammar" ? "语法" : "表达"}
                      </p>
                      <p className="text-xs">
                        <span className="line-through text-muted">{issue.original}</span>
                        {" → "}
                        <span className="font-bold text-leaf-deep">
                          {issue.replacement}
                        </span>
                      </p>
                      <p className="text-xs text-muted">{issue.note}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">{textState.data.explanation}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => speakText(textState.data.suggestion)}
                  className="inline-flex items-center gap-1 text-xs font-bold"
                >
                  <Volume2 className="h-3.5 w-3.5" /> 朗读
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyText(textState.data.suggestion).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  type="button"
                  onClick={() => props.onUseSuggestion(textState.data.suggestion)}
                  className="text-xs font-bold text-coral-deep"
                >
                  放入输入框
                </button>
              </div>
            </>
          )}
          {props.meta.source === "typed" && (
            <p className="mt-3 text-xs text-muted">本句为文字输入，无法评测发音</p>
          )}
          {props.meta.source !== "typed" && !props.meta.pcm && (
            <p className="mt-3 text-xs text-muted">这轮录音已释放，无法评测发音</p>
          )}
          {canAssessPronunciation && pronunciationState.status === "loading" && (
            <p aria-live="polite" className="mt-3 text-xs text-muted">正在评测发音…</p>
          )}
          {canAssessPronunciation && pronunciationState.status === "error" && (
            <div role="alert" className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-[#e6503d]">发音评测失败，可单独重试</span>
              <button type="button" onClick={() => void loadPronunciation(true)}>
                重试
              </button>
            </div>
          )}
          {pronunciationState.status === "ready" && (
            <>
              {props.meta.source === "mixed" && (
                <p className="mt-3 text-xs text-muted">
                  评测语音片段：{props.meta.spokenText}
                </p>
              )}
              <PronunciationFeedback result={pronunciationState.data} />
              <p className="mt-1 text-[0.6rem] text-muted">
                基于讯飞评测与识别文本，仅作练习参考。
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Move bubble rendering into a focused component**

Create `frontend/src/components/ChatBubble.tsx` with props:

```tsx
import { Volume2 } from "lucide-react";
import type { ScenarioTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { PronounceButton } from "./PronounceButton";
import {
  TurnCorrectionCard,
  type TurnCorrectionCardProps,
} from "./TurnCorrectionCard";

export interface ChatBubbleProps {
  role: "user" | "assistant";
  text: string;
  theme: ScenarioTheme;
  onSpeak?: () => void;
  correction?: TurnCorrectionCardProps;
}

export function ChatBubble({
  role,
  text,
  theme,
  onSpeak,
  correction,
}: ChatBubbleProps) {
  const isPip = role === "assistant";
  return (
    <div className={cn("flex", isPip ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-3xl px-4 py-3 shadow-soft",
          isPip ? "rounded-tl-md" : "rounded-tr-md",
        )}
        style={
          isPip
            ? { background: theme.soft, color: "#43302b" }
            : { background: "var(--coral)", color: "var(--coral-fg)" }
        }
      >
        <p className="text-[0.66rem] font-bold uppercase tracking-wide opacity-70">
          {isPip ? "Pip" : "You"}
        </p>
        <p className="mt-0.5 leading-snug">{text}</p>
        {isPip && (
          <div className="mt-1.5 flex flex-col gap-1">
            {onSpeak && (
              <button
                type="button"
                onClick={onSpeak}
                aria-label="朗读"
                className="inline-flex w-fit items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
              >
                <Volume2 className="h-3.5 w-3.5" /> 朗读
              </button>
            )}
            <PronounceButton text={text} />
          </div>
        )}
        {!isPip && correction && <TurnCorrectionCard {...correction} />}
      </div>
    </div>
  );
}
```

Delete the local `Bubble` function from `Conversation.tsx`.

- [ ] **Step 7: Attach typed, push-to-talk, and call metadata in Conversation**

First, in `frontend/src/lib/call.ts`, replace the `reply` callback type with:

```ts
reply: (
  userText: string,
  pcm: ArrayBuffer,
  onSpeaking: () => void,
) => Promise<void>;
```

In `handle(pcm)`, call:

```ts
await cb.reply(text, pcm, () => {
  if (ended) return;
  speaking = true;
  bargeMs = 0;
  cb.onPhase("speaking");
});
```

Do not add PCM to a chat request or log.

Then update `Conversation.tsx`:

1. Add:

```ts
const [turnMeta, setTurnMeta] = useState<UserTurnMetaMap>({});
```

2. Change `send` to accept metadata:

```ts
async function send(
  textArg?: string,
  meta: UserTurnMeta = { source: "typed" },
) {
  const text = (textArg ?? input).trim();
  if (!text || loading || booting || !id) return;
  const appended = appendUserTurn(messages, turnMeta, text, meta);
  setTurnMeta(appended.meta);
  const next = appended.messages;
  setMessages(next);
  // keep the existing stream/fallback reply logic below this point
}
```

3. In push-to-talk, preserve PCM and distinguish mixed input:

```ts
const pcm = await rec.stop();
const spokenText = (await postAsr(pcm)).trim();
if (spokenText) {
  const typedPrefix = input.trim();
  const combined = typedPrefix ? `${typedPrefix} ${spokenText}` : spokenText;
  void send(combined, {
    source: typedPrefix ? "mixed" : "voice",
    spokenText,
    pcm,
  });
}
```

4. Change the call callback to:

```ts
reply: async (userText, pcm, onSpeaking) => {
  const current = messagesRef.current;
  const appended = appendUserTurn(current, turnMetaRef.current, userText, {
    source: "voice",
    spokenText: userText,
    pcm,
  });
  setTurnMeta(appended.meta);
  const next = appended.messages;
  setMessages(next);
  // keep the existing streaming reply and speech queue logic
},
```

Use a `turnMetaRef` synchronized in an effect, exactly as `messagesRef` is, so call mode never closes over an old metadata map:

```ts
const turnMetaRef = useRef<UserTurnMetaMap>(turnMeta);
useEffect(() => {
  turnMetaRef.current = turnMeta;
}, [turnMeta]);
```

The call callback must pass `turnMetaRef.current` to `appendUserTurn`.

5. On unmount, clear the ref:

```ts
turnMetaRef.current = {};
```

6. Render `ChatBubble`:

```tsx
{messages.map((message, index) => (
  <ChatBubble
    key={index}
    role={message.role}
    text={message.content}
    theme={t}
    onSpeak={
      message.role === "assistant"
        ? () => void playTts(message.content)
        : undefined
    }
    correction={
      message.role === "user"
        ? {
            scenarioId: id,
            text: message.content,
            previousPartnerMessage: previousPartnerMessage(messages, index),
            custom: isCustom ? customScene ?? undefined : undefined,
            meta: turnMeta[index] ?? { source: "typed" },
            onUseSuggestion: (suggestion) => setInput(suggestion),
          }
        : undefined
    }
  />
))}
```

- [ ] **Step 8: Run correction tests, typecheck, and lint**

Run:

```powershell
cd frontend
npm run test -- --run src/lib/conversationTurns.test.ts src/components/TurnCorrectionCard.test.tsx
npm run test -- --run src/lib/clipboard.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Milestone A**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/setup.ts frontend/src/lib/conversationTurns.ts frontend/src/lib/conversationTurns.test.ts frontend/src/lib/clipboard.ts frontend/src/lib/clipboard.test.ts frontend/src/lib/call.ts frontend/src/lib/api.ts frontend/src/components/PronunciationFeedback.tsx frontend/src/components/PronounceButton.tsx frontend/src/components/TurnCorrectionCard.tsx frontend/src/components/TurnCorrectionCard.test.tsx frontend/src/components/ChatBubble.tsx frontend/src/pages/Conversation.tsx
git commit -m "feat: add instant correction to learner turns"
```

## Milestone B — Click and selection dictionary

### Task 4: Add the dictionary backend with a TTL/LRU cache

**Files:**
- Create: `backend/app/schemas/dictionary.py`
- Create: `backend/app/services/dictionary.py`
- Create: `backend/app/api/dictionary.py`
- Create: `backend/tests/test_dictionary.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `DeepSeekClient.chat()` and `get_client`.
- Produces: `POST /api/dictionary/lookup`, `normalize_dictionary_query()`, `lookup_dictionary()`, and `clear_dictionary_cache()`.

- [ ] **Step 1: Write failing endpoint and cache tests**

Create `backend/tests/test_dictionary.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services import dictionary as dictionary_service

client = TestClient(app)


class _Stub:
    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, **kwargs):
        self.calls += 1
        return json.dumps(
            {
                "phonetic": "",
                "part_of_speech": "phrasal verb",
                "meaning": "偶然遇见；碰到",
                "example": "I ran into an old friend at the station.",
                "example_zh": "我在车站偶遇了一位老朋友。",
            }
        )


@pytest.fixture(autouse=True)
def _clear_cache():
    dictionary_service.clear_dictionary_cache()
    yield
    dictionary_service.clear_dictionary_cache()


def test_dictionary_normalizes_phrase_and_returns_entry():
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        response = client.post("/api/dictionary/lookup", json={"query": "  run   into, "})
        assert response.status_code == 200
        assert response.json() == {
            "query": "run into",
            "phonetic": "",
            "part_of_speech": "phrasal verb",
            "meaning": "偶然遇见；碰到",
            "example": "I ran into an old friend at the station.",
            "example_zh": "我在车站偶遇了一位老朋友。",
        }
    finally:
        app.dependency_overrides.clear()


def test_dictionary_cache_uses_case_insensitive_key():
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        assert client.post("/api/dictionary/lookup", json={"query": "Run Into"}).status_code == 200
        assert client.post("/api/dictionary/lookup", json={"query": "run into"}).status_code == 200
        assert stub.calls == 1
    finally:
        app.dependency_overrides.clear()


def test_dictionary_cache_expires(monkeypatch):
    now = 100.0
    monkeypatch.setattr(dictionary_service, "_now", lambda: now)
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        client.post("/api/dictionary/lookup", json={"query": "run into"})
        now += 86_401
        client.post("/api/dictionary/lookup", json={"query": "run into"})
        assert stub.calls == 2
    finally:
        app.dependency_overrides.clear()


def test_dictionary_rejects_invalid_queries():
    assert client.post("/api/dictionary/lookup", json={"query": "123"}).status_code == 422
    assert client.post(
        "/api/dictionary/lookup",
        json={"query": "one two three four five six seven"},
    ).status_code == 422
    assert client.post(
        "/api/dictionary/lookup",
        json={"query": "x" * 81},
    ).status_code == 422
```

- [ ] **Step 2: Run tests and confirm the route/service are missing**

Run:

```powershell
cd backend
pytest tests/test_dictionary.py -q
```

Expected: import or route failures because dictionary modules do not exist.

- [ ] **Step 3: Implement query normalization and schemas**

Create `backend/app/schemas/dictionary.py`:

```python
import re

from pydantic import BaseModel, Field, field_validator

_WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")


def normalize_dictionary_query(raw: str) -> str:
    value = re.sub(r"\s+", " ", raw.strip())
    value = re.sub(r"^[^A-Za-z]+|[^A-Za-z'-]+$", "", value)
    if not value or not _WORD_RE.search(value):
        raise ValueError("query must contain English letters")
    if len(value) > 80:
        raise ValueError("query is too long")
    if len(_WORD_RE.findall(value)) > 6:
        raise ValueError("query contains more than six words")
    return value


class DictionaryLookupRequest(BaseModel):
    query: str = Field(min_length=1, max_length=120)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        return normalize_dictionary_query(value)


class DictionaryEntry(BaseModel):
    query: str
    phonetic: str = Field(default="", max_length=120)
    part_of_speech: str = Field(default="", max_length=80)
    meaning: str = Field(min_length=1, max_length=600)
    example: str = Field(min_length=1, max_length=600)
    example_zh: str = Field(min_length=1, max_length=600)
```

- [ ] **Step 4: Implement DeepSeek lookup and bounded TTL/LRU storage**

Create `backend/app/services/dictionary.py`:

```python
from __future__ import annotations

import json
import time
from collections import OrderedDict

from pydantic import ValidationError

from app.schemas.dictionary import DictionaryEntry
from app.services.deepseek import DeepSeekClient, DeepSeekError

_CACHE_MAX = 512
_CACHE_TTL_SECONDS = 24 * 60 * 60
_CACHE: OrderedDict[str, tuple[float, DictionaryEntry]] = OrderedDict()

_SYSTEM = """Define one English word or short phrase for a Chinese learner.
Return one JSON object with exactly:
- phonetic: IPA for a single word, or "" when a phrase has no useful single IPA
- part_of_speech: a short English label, or "" when not applicable
- meaning: concise Chinese meaning
- example: one short natural English example
- example_zh: Chinese translation of that example
Use the requested sense most likely in everyday conversation."""


def _now() -> float:
    return time.monotonic()


def clear_dictionary_cache() -> None:
    _CACHE.clear()


async def lookup_dictionary(
    query: str,
    client: DeepSeekClient,
) -> DictionaryEntry:
    key = query.casefold()
    cached = _CACHE.get(key)
    now = _now()
    if cached is not None:
        expires_at, entry = cached
        if expires_at > now:
            _CACHE.move_to_end(key)
            return entry
        del _CACHE[key]

    raw = await client.chat(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Word or phrase: {query}"},
        ],
        temperature=0.2,
        max_tokens=350,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(raw)
        data["query"] = query
        entry = DictionaryEntry(**data)
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise DeepSeekError(f"could not parse dictionary entry: {exc}") from exc

    _CACHE[key] = (now + _CACHE_TTL_SECONDS, entry)
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return entry
```

- [ ] **Step 5: Add the endpoint and router registration**

Create `backend/app/api/dictionary.py`:

```python
from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.schemas.dictionary import DictionaryEntry, DictionaryLookupRequest
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.dictionary import lookup_dictionary

router = APIRouter(tags=["dictionary"])


@router.post("/dictionary/lookup", response_model=DictionaryEntry)
async def dictionary_lookup(
    request: DictionaryLookupRequest,
    client: DeepSeekClient = Depends(get_client),
) -> DictionaryEntry:
    try:
        return await lookup_dictionary(request.query, client)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
```

Register `dictionary.router` in `backend/app/main.py`.

- [ ] **Step 6: Run focused tests**

```powershell
cd backend
pytest tests/test_dictionary.py tests/test_words.py -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit the backend dictionary**

```powershell
git add backend/app/api/dictionary.py backend/app/schemas/dictionary.py backend/app/services/dictionary.py backend/app/main.py backend/tests/test_dictionary.py
git commit -m "feat: add cached dictionary lookup"
```

### Task 5: Add the frontend dictionary client cache

**Files:**
- Create: `frontend/src/lib/dictionary.ts`
- Create: `frontend/src/lib/dictionary.test.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `postDictionaryLookup(query)`.
- Produces: `DictionaryEntry`, `normalizeDictionaryQuery()`, `getDictionaryEntry()`, and `clearDictionarySessionCache()`.

- [ ] **Step 1: Write failing cache, de-duplication, and abort tests**

Create `frontend/src/lib/dictionary.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postDictionaryLookup } from "./api";
import {
  clearDictionarySessionCache,
  getDictionaryEntry,
  normalizeDictionaryQuery,
} from "./dictionary";

vi.mock("./api", () => ({
  postDictionaryLookup: vi.fn(),
}));

const entry = {
  query: "run into",
  phonetic: "",
  part_of_speech: "phrasal verb",
  meaning: "偶然遇见",
  example: "I ran into a friend.",
  example_zh: "我偶遇了一位朋友。",
};

describe("dictionary session client", () => {
  beforeEach(() => {
    clearDictionarySessionCache();
    vi.mocked(postDictionaryLookup).mockReset();
    vi.mocked(postDictionaryLookup).mockResolvedValue(entry);
  });

  it("normalizes punctuation and spacing and rejects over-six-word selections", () => {
    expect(normalizeDictionaryQuery("  run   into, ")).toBe("run into");
    expect(normalizeDictionaryQuery("123")).toBeNull();
    expect(normalizeDictionaryQuery("one two three four five six seven")).toBeNull();
  });

  it("returns a cached value without a second request", async () => {
    await getDictionaryEntry("Run Into");
    await getDictionaryEntry("run into");
    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent requests", async () => {
    let resolve!: (value: typeof entry) => void;
    vi.mocked(postDictionaryLookup).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = getDictionaryEntry("run into");
    const second = getDictionaryEntry("Run Into");
    resolve(entry);
    await expect(first).resolves.toEqual(entry);
    await expect(second).resolves.toEqual(entry);
    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });

  it("lets an old UI subscriber abort without cancelling the shared lookup", async () => {
    const controller = new AbortController();
    const oldSubscriber = getDictionaryEntry("run into", controller.signal);
    controller.abort();
    await expect(oldSubscriber).rejects.toMatchObject({ name: "AbortError" });
    await expect(getDictionaryEntry("run into")).resolves.toEqual(entry);
    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm the module/API are missing**

```powershell
cd frontend
npm run test -- --run src/lib/dictionary.test.ts
```

Expected: fail because the dictionary client does not exist.

- [ ] **Step 3: Add dictionary API types and request**

Add to `frontend/src/lib/api.ts`:

```ts
export interface DictionaryEntry {
  query: string;
  phonetic: string;
  part_of_speech: string;
  meaning: string;
  example: string;
  example_zh: string;
}

export function postDictionaryLookup(
  query: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> {
  return request<DictionaryEntry>("/api/dictionary/lookup", {
    method: "POST",
    body: JSON.stringify({ query }),
    signal,
  });
}
```

- [ ] **Step 4: Implement normalization, cache, shared requests, and subscriber abort**

Create `frontend/src/lib/dictionary.ts`:

```ts
import {
  postDictionaryLookup,
  type DictionaryEntry,
} from "./api";

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const cache = new Map<string, DictionaryEntry>();
const inflight = new Map<string, Promise<DictionaryEntry>>();

export function normalizeDictionaryQuery(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, " ");
  const cleaned = compact.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
  const words = cleaned.match(WORD_RE) ?? [];
  if (!cleaned || !words.length || cleaned.length > 80 || words.length > 6) return null;
  return cleaned;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function forSubscriber<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function clearDictionarySessionCache(): void {
  cache.clear();
  inflight.clear();
}

export function getDictionaryEntry(
  raw: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> {
  const query = normalizeDictionaryQuery(raw);
  if (!query) return Promise.reject(new Error("Invalid dictionary query"));
  const key = query.toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached) return forSubscriber(Promise.resolve(cached), signal);

  let request = inflight.get(key);
  if (!request) {
    request = postDictionaryLookup(query)
      .then((entry) => {
        cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, request);
  }
  return forSubscriber(request, signal);
}
```

- [ ] **Step 5: Run the focused test**

```powershell
cd frontend
npm run test -- --run src/lib/dictionary.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit the dictionary data layer**

```powershell
git add frontend/src/lib/api.ts frontend/src/lib/dictionary.ts frontend/src/lib/dictionary.test.ts
git commit -m "feat: add dictionary session cache"
```

### Task 6: Add the dictionary provider, overlay, and interactive English text

**Files:**
- Create: `frontend/src/components/dictionary/DictionaryProvider.tsx`
- Create: `frontend/src/components/dictionary/DictionaryOverlay.tsx`
- Create: `frontend/src/components/dictionary/InteractiveEnglishText.tsx`
- Create: `frontend/src/components/dictionary/InteractiveEnglishText.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ChatBubble.tsx`
- Modify: `frontend/src/components/TurnCorrectionCard.tsx`
- Modify: `frontend/src/pages/Daily.tsx`
- Modify: `frontend/src/pages/Report.tsx`
- Modify: `frontend/src/pages/SessionView.tsx`
- Modify: `frontend/src/pages/WordBag.tsx`
- Modify: `frontend/src/store/words.ts`
- Modify: `backend/app/schemas/word.py`
- Modify: `backend/app/models/word.py`
- Delete: `frontend/src/components/WordCollector.tsx`

**Interfaces:**
- Consumes: `getDictionaryEntry()`, `speakText()`, and `useWords.collect()`.
- Produces: `DictionaryProvider`, `useDictionary()`, and `InteractiveEnglishText`.

- [ ] **Step 1: Write failing word-click, punctuation, selection, and overlay tests**

Create `frontend/src/components/dictionary/InteractiveEnglishText.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postDictionaryLookup } from "../../lib/api";
import { clearDictionarySessionCache } from "../../lib/dictionary";
import { DictionaryProvider } from "./DictionaryProvider";
import { InteractiveEnglishText } from "./InteractiveEnglishText";

vi.mock("../../lib/api", () => ({
  postDictionaryLookup: vi.fn(),
}));

vi.mock("../../lib/speech", () => ({
  speakText: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
}));

vi.mock("../../store/words", () => ({
  useWords: (selector: (state: { words: never[]; collect: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ words: [], collect: vi.fn() }),
}));

describe("InteractiveEnglishText", () => {
  beforeEach(() => {
    clearDictionarySessionCache();
    vi.mocked(postDictionaryLookup).mockReset();
    vi.mocked(postDictionaryLookup).mockResolvedValue({
      query: "world",
      phonetic: "/wɜːrld/",
      part_of_speech: "noun",
      meaning: "世界",
      example: "The world is changing.",
      example_zh: "世界正在变化。",
    });
  });

  it("keeps punctuation visible and opens a word lookup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DictionaryProvider>
        <InteractiveEnglishText text="Hello, world!" />
      </DictionaryProvider>,
    );
    expect(container).toHaveTextContent("Hello, world!");
    await user.click(screen.getByRole("button", { name: "查询 world" }));
    expect(await screen.findByText("世界")).toBeInTheDocument();
    expect(postDictionaryLookup).toHaveBeenCalledWith("world");
  });

  it("does not fire a word click while a phrase selection exists", async () => {
    const user = userEvent.setup();
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "Hello world",
    } as Selection);
    render(
      <DictionaryProvider>
        <InteractiveEnglishText text="Hello world" />
      </DictionaryProvider>,
    );
    await user.click(screen.getByRole("button", { name: "查询 Hello" }));
    expect(postDictionaryLookup).not.toHaveBeenCalled();
    getSelection.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and confirm components are missing**

```powershell
cd frontend
npm run test -- --run src/components/dictionary/InteractiveEnglishText.test.tsx
```

Expected: fail because dictionary UI components do not exist.

- [ ] **Step 3: Implement the provider contract and phrase selection listener**

Create `frontend/src/components/dictionary/DictionaryProvider.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeDictionaryQuery } from "../../lib/dictionary";
import { DictionaryOverlay } from "./DictionaryOverlay";

export interface DictionaryOpenRequest {
  query: string;
  rect: DOMRect;
  trigger: HTMLElement | null;
}

interface DictionaryContextValue {
  openDictionary: (request: DictionaryOpenRequest) => void;
}

const DictionaryContext = createContext<DictionaryContextValue | null>(null);

export function useDictionary(): DictionaryContextValue {
  const value = useContext(DictionaryContext);
  if (!value) throw new Error("useDictionary must be used inside DictionaryProvider");
  return value;
}

export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DictionaryOpenRequest | null>(null);

  const openDictionary = useCallback((next: DictionaryOpenRequest) => {
    const query = normalizeDictionaryQuery(next.query);
    if (!query) return;
    setRequest({ ...next, query });
  }, []);

  useEffect(() => {
    const openSelection = () => {
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
        const node = selection.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        if (!element?.closest("[data-dictionary-text]")) return;
        const query = normalizeDictionaryQuery(selection.toString());
        if (!query) return;
        openDictionary({
          query,
          rect: selection.getRangeAt(0).getBoundingClientRect(),
          trigger: element.closest("[data-dictionary-text]") as HTMLElement,
        });
      }, 0);
    };
    document.addEventListener("mouseup", openSelection);
    document.addEventListener("touchend", openSelection);
    return () => {
      document.removeEventListener("mouseup", openSelection);
      document.removeEventListener("touchend", openSelection);
    };
  }, [openDictionary]);

  const value = useMemo(() => ({ openDictionary }), [openDictionary]);
  return (
    <DictionaryContext.Provider value={value}>
      {children}
      <DictionaryOverlay request={request} onClose={() => setRequest(null)} />
    </DictionaryContext.Provider>
  );
}
```

- [ ] **Step 4: Implement clickable word tokenization**

Create `frontend/src/components/dictionary/InteractiveEnglishText.tsx`:

```tsx
import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "../../lib/utils";
import { useDictionary } from "./DictionaryProvider";

const TOKEN_RE = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/g;
const WORD_TOKEN_RE = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;

export function InteractiveEnglishText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { openDictionary } = useDictionary();
  const parts = text.split(TOKEN_RE);

  function selectedPhraseExists(): boolean {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  }

  function openWord(
    word: string,
    target: HTMLElement,
    event?: MouseEvent | KeyboardEvent,
  ) {
    event?.stopPropagation();
    if (selectedPhraseExists()) return;
    openDictionary({
      query: word,
      rect: target.getBoundingClientRect(),
      trigger: target,
    });
  }

  return (
    <span data-dictionary-text tabIndex={-1} className={className}>
      {parts.map((part, index) =>
        WORD_TOKEN_RE.test(part) ? (
          <span
            key={`${part}-${index}`}
            role="button"
            tabIndex={0}
            aria-label={`查询 ${part}`}
            className={cn(
              "cursor-help select-text rounded-sm underline decoration-dotted decoration-current/35 underline-offset-2",
            )}
            onClick={(event) => openWord(part, event.currentTarget, event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openWord(part, event.currentTarget, event);
              }
            }}
          >
            {part}
          </span>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
```

- [ ] **Step 5: Implement the responsive overlay with request ordering and focus return**

Create `frontend/src/components/dictionary/DictionaryOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Plus, RotateCcw, Volume2, X } from "lucide-react";
import type { DictionaryEntry } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { getDictionaryEntry } from "../../lib/dictionary";
import { speakText } from "../../lib/speech";
import { useWords } from "../../store/words";
import type { DictionaryOpenRequest } from "./DictionaryProvider";

export function DictionaryOverlay({
  request,
  onClose,
}: {
  request: DictionaryOpenRequest | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { status: "idle" | "loading" | "error"; entry?: undefined }
    | { status: "ready"; entry: DictionaryEntry }
  >({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const words = useWords((value) => value.words);
  const collect = useWords((value) => value.collect);

  useEffect(() => {
    if (!request) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    getDictionaryEntry(request.query, controller.signal).then(
      (entry) => setState({ status: "ready", entry }),
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error" });
      },
    );
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        request.trigger?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, request]);

  if (!request) return null;
  const mobile = window.matchMedia("(max-width: 639px)").matches;
  const left = Math.max(12, Math.min(window.innerWidth - 372, request.rect.left));
  const top = Math.min(window.innerHeight - 420, request.rect.bottom + 10);
  const collected =
    state.status === "ready" &&
    words.some((word) => word.text.toLocaleLowerCase() === state.entry.query.toLocaleLowerCase());

  function close() {
    onClose();
    window.getSelection()?.removeAllRanges();
    request.trigger?.focus();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/10" onMouseDown={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`词典：${request.query}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={
          mobile
            ? "absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[72vh] overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-pop"
            : "absolute w-[360px] max-h-[70vh] overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-pop"
        }
        style={mobile ? undefined : { left, top }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="关闭词典"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface-2"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="pr-10 font-display text-xl font-semibold text-ink">
          {request.query}
        </h2>
        {state.status === "loading" && (
          <p aria-live="polite" className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在查词…
          </p>
        )}
        {state.status === "error" && (
          <div role="alert" className="mt-4">
            <p className="text-sm text-[#e6503d]">查询失败，请稍后重试。</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                getDictionaryEntry(request.query).then(
                  (entry) => setState({ status: "ready", entry }),
                  () => setState({ status: "error" }),
                );
              }}
              className="mt-2 inline-flex items-center gap-1 text-sm font-bold"
            >
              <RotateCcw className="h-4 w-4" /> 重试
            </button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            {(state.entry.phonetic || state.entry.part_of_speech) && (
              <p className="mt-1 text-sm text-muted">
                {state.entry.phonetic}
                {state.entry.phonetic && state.entry.part_of_speech ? " · " : ""}
                {state.entry.part_of_speech}
              </p>
            )}
            <p className="mt-3 text-base font-bold text-ink">{state.entry.meaning}</p>
            <div className="mt-3 rounded-2xl bg-surface-2 p-3">
              <p className="text-sm text-ink">{state.entry.example}</p>
              <p className="mt-1 text-xs text-muted">{state.entry.example_zh}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => speakText(state.entry.query)}>
                <Volume2 className="h-4 w-4" /> 朗读
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyText(state.entry.query).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  });
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "已复制" : "复制"}
              </button>
              <button
                type="button"
                disabled={collected}
                onClick={() =>
                  collect({
                    text: state.entry.query,
                    meaning: state.entry.meaning,
                    example: state.entry.example,
                    kind: state.entry.query.trim().split(/\s+/).length > 1 ? "phrase" : "word",
                  })
                }
              >
                {collected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {collected ? "已收藏" : "加入生词本"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Mount the provider and remove the old collector**

In `frontend/src/App.tsx`:

- Remove the `WordCollector` import.
- Import `DictionaryProvider`.
- Return this structure:

```tsx
export default function App() {
  return (
    <DictionaryProvider>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/custom" element={<CustomScenePage />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/practice/:scenarioId" element={<Conversation />} />
          <Route path="/report/:sessionId" element={<Report />} />
          <Route path="/session/:id" element={<SessionView />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/words" element={<WordBag />} />
          <Route path="/me" element={<Profile />} />
          <Route path="/daily" element={<Daily />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Onboarding />
    </DictionaryProvider>
  );
}
```

Delete `frontend/src/components/WordCollector.tsx`.

- [ ] **Step 7: Replace English learning text on all approved surfaces**

Use:

```tsx
<InteractiveEnglishText text={value} />
```

at these exact locations:

- `ChatBubble.tsx`: the main message text for both Pip and learner.
- `TurnCorrectionCard.tsx`: original sentence, suggestion, issue original, and replacement.
- `Daily.tsx`: `q.text`.
- `Report.tsx`: correction original, correction suggestion, and phrase text.
- `SessionView.tsx`: each saved message content.

Do not wrap Chinese notes, author names, scores, buttons, or editable inputs.

- [ ] **Step 8: Treat phrases as word-list entries without a migration**

Update comments in `backend/app/schemas/word.py` and `backend/app/models/word.py` to list `word | phrase | sentence`.

In `WordBag.tsx`, replace:

```ts
const kindOf = (w: Word) => (w.kind === "sentence" ? "sentence" : "word");
```

with the same executable expression plus a comment that both `word` and `phrase` belong to the word tab.

In `frontend/src/store/words.ts`, update the `kind` documentation to include `"phrase"`.

- [ ] **Step 9: Run UI, dictionary, type, and lint tests**

```powershell
cd frontend
npm run test -- --run src/lib/dictionary.test.ts src/components/dictionary/InteractiveEnglishText.test.tsx src/components/TurnCorrectionCard.test.tsx
npm run test -- --run src/lib/clipboard.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 10: Commit Milestone B**

```powershell
git add frontend/src/lib/api.ts frontend/src/lib/dictionary.ts frontend/src/lib/dictionary.test.ts frontend/src/components/dictionary frontend/src/App.tsx frontend/src/components/ChatBubble.tsx frontend/src/components/TurnCorrectionCard.tsx frontend/src/pages/Daily.tsx frontend/src/pages/Report.tsx frontend/src/pages/SessionView.tsx frontend/src/pages/WordBag.tsx frontend/src/store/words.ts backend/app/schemas/word.py backend/app/models/word.py
git rm frontend/src/components/WordCollector.tsx
git commit -m "feat: add click and selection dictionary"
```

## Milestone C — Mobile read-aloud fallback and connected cloud speech

### Task 7: Resolve browser versus cloud read-aloud deterministically

**Files:**
- Create: `frontend/src/lib/voiceResolver.ts`
- Create: `frontend/src/lib/voiceResolver.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/speech.ts`
- Modify: `frontend/src/pages/Profile.tsx`

**Interfaces:**
- Consumes: `useVoice` state and browser `speechSynthesis`.
- Produces: `resolveVoiceMode()`, `autoCloudOverrides()`, and optional `TtsOverrides` for `fetchTtsUrl()`.

- [ ] **Step 1: Write failing resolution tests**

Create `frontend/src/lib/voiceResolver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  AUTO_CLOUD_PITCH,
  AUTO_CLOUD_SPEED,
  AUTO_CLOUD_VOICE,
  autoCloudOverrides,
  resolveVoiceMode,
} from "./voiceResolver";

const englishVoice = { lang: "en-US", name: "English", voiceURI: "en" } as SpeechSynthesisVoice;

describe("voiceResolver", () => {
  it("uses explicit cloud mode immediately", async () => {
    await expect(
      resolveVoiceMode("iflytek", {
        listEnglishVoices: () => [],
        subscribe: () => () => undefined,
        timeoutMs: 500,
      }),
    ).resolves.toEqual({ kind: "iflytek", automaticFallback: false });
  });

  it("uses an English browser voice immediately when present", async () => {
    await expect(
      resolveVoiceMode("browser", {
        listEnglishVoices: () => [englishVoice],
        subscribe: () => () => undefined,
        timeoutMs: 500,
      }),
    ).resolves.toEqual({ kind: "browser" });
  });

  it("waits for a delayed voiceschanged event", async () => {
    let voices: SpeechSynthesisVoice[] = [];
    let notify = () => undefined;
    const pending = resolveVoiceMode("browser", {
      listEnglishVoices: () => voices,
      subscribe: (callback) => {
        notify = callback;
        return () => undefined;
      },
      timeoutMs: 500,
    });
    voices = [englishVoice];
    notify();
    await expect(pending).resolves.toEqual({ kind: "browser" });
  });

  it("falls back after 500 ms and respects user cloud overrides", async () => {
    vi.useFakeTimers();
    const pending = resolveVoiceMode("browser", {
      listEnglishVoices: () => [],
      subscribe: () => () => undefined,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({
      kind: "iflytek",
      automaticFallback: true,
    });
    expect(autoCloudOverrides({ vcn: null, speed: null, pitch: null })).toEqual({
      vcn: AUTO_CLOUD_VOICE,
      speed: AUTO_CLOUD_SPEED,
      pitch: AUTO_CLOUD_PITCH,
    });
    expect(autoCloudOverrides({ vcn: "henry", speed: 40, pitch: 60 })).toEqual({
      vcn: "henry",
      speed: 40,
      pitch: 60,
    });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test and confirm the module is missing**

```powershell
cd frontend
npm run test -- --run src/lib/voiceResolver.test.ts
```

Expected: fail because `voiceResolver.ts` does not exist.

- [ ] **Step 3: Implement engine resolution and fallback constants**

Create `frontend/src/lib/voiceResolver.ts`:

```ts
import type { VoiceEngine } from "../store/voice";

export const AUTO_CLOUD_VOICE = "x4_lindsey_formal";
export const AUTO_CLOUD_SPEED = 58;
export const AUTO_CLOUD_PITCH = 52;

export type ResolvedVoiceMode =
  | { kind: "browser" }
  | { kind: "iflytek"; automaticFallback: boolean };

export interface VoiceResolutionSource {
  listEnglishVoices: () => SpeechSynthesisVoice[];
  subscribe: (callback: () => void) => () => void;
  timeoutMs: number;
}

export async function resolveVoiceMode(
  engine: VoiceEngine,
  source: VoiceResolutionSource,
): Promise<ResolvedVoiceMode> {
  if (engine === "iflytek") {
    return { kind: "iflytek", automaticFallback: false };
  }
  if (source.listEnglishVoices().length > 0) return { kind: "browser" };

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => undefined;
    let timer = 0;
    const finish = (result: ResolvedVoiceMode) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    unsubscribe = source.subscribe(() => {
      if (source.listEnglishVoices().length > 0) finish({ kind: "browser" });
    });
    timer = window.setTimeout(
      () => finish({ kind: "iflytek", automaticFallback: true }),
      source.timeoutMs,
    );
  });
}

export function autoCloudOverrides(settings: {
  vcn: string | null;
  speed: number | null;
  pitch: number | null;
}) {
  return {
    vcn: settings.vcn ?? AUTO_CLOUD_VOICE,
    speed: settings.speed ?? AUTO_CLOUD_SPEED,
    pitch: settings.pitch ?? AUTO_CLOUD_PITCH,
  };
}
```

- [ ] **Step 4: Let TTS calls receive explicit fallback overrides**

In `frontend/src/lib/api.ts`, add:

```ts
export interface TtsOverrides {
  vcn?: string;
  speed?: number;
  pitch?: number;
}
```

Change `fetchTtsUrl` to:

```ts
export async function fetchTtsUrl(
  text: string,
  scenarioId?: string,
  signal?: AbortSignal,
  overrides?: TtsOverrides,
): Promise<string> {
  const voice = useVoice.getState();
  const body: Record<string, unknown> = { text, scenario_id: scenarioId };
  const vcn = overrides?.vcn ?? voice.vcn;
  const speed = overrides?.speed ?? voice.speed;
  const pitch = overrides?.pitch ?? voice.pitch;
  if (vcn != null) body.vcn = vcn;
  if (speed != null) body.speed = speed;
  if (pitch != null) body.pitch = pitch;
  const res = await fetch(`${BASE_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(signal, 30_000),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
```

- [ ] **Step 5: Make single-line and queue speech await one resolved mode**

In `frontend/src/lib/speech.ts`:

1. Import `resolveVoiceMode` and `autoCloudOverrides`.
2. Add a `voiceSource()` helper:

```ts
function voiceSource() {
  return {
    listEnglishVoices: listBrowserVoices,
    subscribe: (callback: () => void) => {
      if (!hasSpeech()) return () => undefined;
      window.speechSynthesis.addEventListener("voiceschanged", callback);
      return () =>
        window.speechSynthesis.removeEventListener("voiceschanged", callback);
    },
    timeoutMs: 500,
  };
}
```

3. Change `speakIflytek` to:

```ts
function speakIflytek(
  text: string,
  scenarioId?: string,
  overrides?: TtsOverrides,
): Speaking {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let stopped = false;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const cleanup = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    settle();
  };
  fetchTtsUrl(text, scenarioId, undefined, overrides)
    .then((nextUrl) => {
      if (stopped) {
        URL.revokeObjectURL(nextUrl);
        settle();
        return;
      }
      url = nextUrl;
      audio = new Audio(nextUrl);
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(cleanup);
    })
    .catch(() => settle());
  return {
    done,
    stop: () => {
      stopped = true;
      audio?.pause();
      cleanup();
    },
  };
}
```

Import `type TtsOverrides` from `api.ts`.
4. Add a deferred wrapper:

```ts
function speakResolved(text: string, scenarioId?: string): Speaking {
  let active: Speaking | null = null;
  let stopped = false;
  const done = (async () => {
    const voice = useVoice.getState();
    const mode = await resolveVoiceMode(voice.engine, voiceSource());
    if (stopped) return;
    active =
      mode.kind === "browser"
        ? speakBrowser(text)
        : speakIflytek(
            text,
            scenarioId,
            mode.automaticFallback ? autoCloudOverrides(voice) : undefined,
          );
    await active.done;
  })();
  return {
    done,
    stop: () => {
      stopped = true;
      active?.stop();
    },
  };
}
```

5. Make `speakText()` call `speakResolved`.
6. In `createSpeechQueue()`, replace the synchronous `useBrowser` constant with:

```ts
const voiceAtStart = useVoice.getState();
const modePromise = resolveVoiceMode(voiceAtStart.engine, voiceSource());
```

At the beginning of the existing async consumer, resolve one stable mode and overrides:

```ts
const consumer = (async () => {
  const mode = await modePromise;
  const overrides =
    mode.kind === "iflytek" && mode.automaticFallback
      ? autoCloudOverrides(voiceAtStart)
      : undefined;
  let prefetchText: string | null = null;
  let prefetchUrl: Promise<string> | null = null;
  let firstStarted = false;
  while (!stopped) {
    const text = await take();
    if (text == null) break;
    if (!firstStarted) {
      firstStarted = true;
      markStarted?.();
    }

    if (mode.kind === "browser") {
      playing = speakBrowser(text);
      await playing.done;
      continue;
    }

    let url: string;
    try {
      url =
        prefetchText === text && prefetchUrl
          ? await prefetchUrl
          : await fetchTtsUrl(text, scenarioId, undefined, overrides);
    } catch {
      prefetchText = null;
      prefetchUrl = null;
      continue;
    }
    prefetchText = pending[0] ?? null;
    prefetchUrl = prefetchText
      ? fetchTtsUrl(prefetchText, scenarioId, undefined, overrides).catch(() => "")
      : null;
    if (stopped || !url) {
      if (url) URL.revokeObjectURL(url);
      if (stopped) break;
      continue;
    }
    playing = playUrl(url);
    await playing.done;
  }
})();
```

Keep the existing `feed`, `end`, `started`, and `stop` public methods unchanged.

- [ ] **Step 6: Explain the automatic fallback in voice settings**

In `Profile.tsx`, when `engine === "browser"` and `browserVoices.length === 0`, change the copy to:

```tsx
此设备暂未提供英文浏览器音色；朗读时会自动使用自然的讯飞云端音色。
```

Keep both engine choices visible and keep user overrides unchanged.

- [ ] **Step 7: Run voice tests, typecheck, and existing build checks**

```powershell
cd frontend
npm run test -- --run src/lib/voiceResolver.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit the frontend voice fallback**

```powershell
git add frontend/src/lib/voiceResolver.ts frontend/src/lib/voiceResolver.test.ts frontend/src/lib/api.ts frontend/src/lib/speech.ts frontend/src/pages/Profile.tsx
git commit -m "fix: fall back to connected cloud speech"
```

### Task 8: Make cloud silence normalization conservative

**Files:**
- Modify: `backend/app/services/xf_tts.py`
- Modify: `backend/tests/test_tts.py`

**Interfaces:**
- Consumes: raw 16-bit little-endian 16 kHz PCM.
- Produces: `smooth_silences()` that trims only near-zero runs while retaining low-energy speech and longer sentence pauses.

- [ ] **Step 1: Replace waveform tests with the approved safety cases**

Add these tests to `backend/tests/test_tts.py`:

```python
def test_smooth_silences_collapses_only_near_zero_internal_gap():
    rate = SAMPLE_RATE
    tone = array.array("h", [8000, -8000] * (rate // 10))  # 200 ms
    zero_gap = array.array("h", [0] * (rate // 5))  # 200 ms
    pcm = (tone + zero_gap + tone).tobytes()
    out = smooth_silences(pcm)
    assert len(out) < len(pcm)
    assert len(out) >= len((tone + tone).tobytes()) + int(rate * 0.06) * 2


def test_smooth_silences_preserves_low_energy_speech():
    rate = SAMPLE_RATE
    low_energy = array.array("h", [120, -120] * (rate // 2))  # 1 second
    pcm = low_energy.tobytes()
    assert smooth_silences(pcm) == pcm


def test_smooth_silences_keeps_longer_sentence_pause():
    rate = SAMPLE_RATE
    tone = array.array("h", [5000, -5000] * (rate // 10))
    sentence_gap = array.array("h", [0] * (rate // 2))  # 500 ms
    out = smooth_silences((tone + sentence_gap + tone).tobytes())
    kept_samples = len(out) // 2 - len(tone) * 2
    assert kept_samples >= int(rate * 0.18)
```

Keep the existing tests that verify one valid WAV and user voice overrides.

- [ ] **Step 2: Run the focused waveform tests and verify the low-energy test fails**

```powershell
cd backend
pytest tests/test_tts.py -q
```

Expected: the current RMS threshold treats amplitude `120` as silence, so `test_smooth_silences_preserves_low_energy_speech` fails.

- [ ] **Step 3: Change silence detection from broad RMS to near-zero peak**

Replace `smooth_silences()` in `backend/app/services/xf_tts.py` with:

```python
def smooth_silences(
    pcm: bytes,
    *,
    rate: int = SAMPLE_RATE,
    win_ms: int = 10,
    near_zero_peak: int = 64,
    min_trim_ms: int = 120,
    inter_keep_ms: int = 60,
    sentence_min_ms: int = 320,
    sentence_keep_ms: int = 180,
) -> bytes:
    """Shorten only long, near-digital-zero gaps in iFlytek PCM.

    Peak detection deliberately preserves quiet consonants and low-energy speech.
    Leading/trailing near-zero padding is removed. Long internal gaps keep 60 ms,
    while sentence-sized gaps keep 180 ms.
    """
    samples = array.array("h")
    samples.frombytes(pcm)
    win = max(1, rate * win_ms // 1000)
    nwin = (len(samples) + win - 1) // win
    if nwin == 0:
        return pcm

    non_silent = [False] * nwin
    for index in range(nwin):
        segment = samples[index * win : (index + 1) * win]
        non_silent[index] = bool(segment) and max(abs(value) for value in segment) > near_zero_peak

    out = array.array("h")
    index = 0
    seen_voice = False
    while index < nwin:
        if non_silent[index]:
            out.extend(samples[index * win : (index + 1) * win])
            seen_voice = True
            index += 1
            continue

        end = index
        while end < nwin and not non_silent[end]:
            end += 1
        run_ms = (end - index) * win_ms
        trailing = end >= nwin
        if not seen_voice or trailing:
            keep_ms = 0
        elif run_ms < min_trim_ms:
            keep_ms = run_ms
        elif run_ms >= sentence_min_ms:
            keep_ms = sentence_keep_ms
        else:
            keep_ms = inter_keep_ms
        keep_windows = min(end - index, keep_ms // win_ms)
        if keep_windows:
            out.extend(samples[index * win : (index + keep_windows) * win])
        index = end

    return out.tobytes() if out else pcm
```

- [ ] **Step 4: Run TTS and full backend tests**

```powershell
cd backend
pytest tests/test_tts.py -q
pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 5: Commit the waveform change**

```powershell
git add backend/app/services/xf_tts.py backend/tests/test_tts.py
git commit -m "fix: preserve connected speech in cloud TTS"
```

## Milestone D — Documentation, full verification, and deployment

### Task 9: Document the new interaction and run complete local verification

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOY.md` only if the deployment or environment-variable instructions changed.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: user-facing documentation and a release candidate with complete evidence.

- [ ] **Step 1: Update product documentation**

Add concise bullets to both READMEs:

- Every learner turn has optional instant grammar/expression correction.
- Voice turns can show pronunciation feedback without saving audio.
- Click a word or select a phrase for a Chinese dictionary card and collection.
- Devices without an English browser voice automatically use connected cloud speech.

Update `docs/ARCHITECTURE.md` with:

- `/api/turn-correction`;
- `/api/dictionary/lookup`;
- browser-only PCM metadata retention;
- frontend/backend dictionary caches;
- read-aloud engine resolution.

Do not add a new required environment variable.

- [ ] **Step 2: Run all frontend tests and checks**

```powershell
cd frontend
npm run test -- --run
npm run lint
npm run typecheck
npm run build
```

Expected: zero failed tests, lint errors, TypeScript errors, or build errors.

- [ ] **Step 3: Run all backend tests**

```powershell
cd backend
pytest -q
```

Expected: zero failed tests.

- [ ] **Step 4: Run repository whitespace and status checks**

```powershell
git diff --check
git status --short
```

Expected: only the intended documentation changes remain before the documentation commit; no generated audio, `.env`, database, `dist`, or cache files are tracked.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md README.en.md docs/ARCHITECTURE.md docs/DEPLOY.md
git commit -m "docs: explain instant feedback and dictionary"
```

If `docs/DEPLOY.md` did not change, omit it from `git add`.

### Task 10: Perform browser, real-audio, review, and public deployment verification

**Files:**
- No production files unless verification discovers a reproducible defect; any defect starts a fresh failing test before its fix.

**Interfaces:**
- Consumes: the complete branch.
- Produces: reviewed code merged into `main`, successful Vercel/Render deployments, and verified public behavior.

- [ ] **Step 1: Start the local stack**

Use the existing configured local environment:

```powershell
docker compose up --build
```

Expected: frontend at `http://localhost:5173`, backend health at `http://localhost:8000/api/health`.

- [ ] **Step 2: Verify desktop and mobile interaction in a real browser**

Use the in-app browser skill and check both desktop width and a mobile width near 390 px:

1. Send a typed sentence with an obvious error.
2. Confirm Pip replies before correction is opened.
3. Open “即时纠错”; confirm recommendation, explanation, copy, read-aloud, and input reuse.
4. Send a voice turn; confirm pronunciation feedback appears only after opening correction.
5. Type a prefix and append speech; confirm the card labels and assesses only the spoken fragment.
6. Click a word; confirm the desktop anchored card.
7. Select a two-to-six-word phrase; confirm the phrase wins over the word click.
8. At mobile width, confirm a bottom sheet with safe-area spacing, scrolling, Escape/close behavior, and focus return.
9. Collect a phrase and confirm it appears in the word tab.

Expected: no duplicate collector popup and no blocked chat interaction.

- [ ] **Step 3: Verify three real iFlytek samples before deployment**

Request and save temporary WAV files outside the repository for:

```text
I really like this coffee
Actually, could I have oat milk instead?
That sounds great. What time should we meet?
```

Use the local `/api/tts` endpoint with the automatic fallback voice settings. Inspect that each response:

- starts with `RIFF`/`WAVE`;
- contains one WAV stream;
- has no removed low-energy speech at the start or end;
- keeps a longer pause in the two-sentence sample than in ordinary word gaps.

Play each sample through the browser and confirm it no longer sounds word-by-word. If a defect is audible, add a waveform regression test before adjusting `near_zero_peak`, `inter_keep_ms`, or `sentence_keep_ms`.

- [ ] **Step 4: Request code review and address only verified findings**

Invoke `superpowers:requesting-code-review`. Review:

- privacy: PCM never leaves the correction request path or persists;
- request isolation: correction cannot block chat;
- cache bounds and expiry;
- selection/click conflicts on touch;
- speech queue fallback and stop behavior;
- no duplicate dictionary listeners.

Any accepted defect must be reproduced by a failing test first.

- [ ] **Step 5: Re-run fresh verification after review**

```powershell
cd backend
pytest -q
cd ..\frontend
npm run test -- --run
npm run lint
npm run typecheck
npm run build
cd ..
git diff --check
git status --short --branch
```

Expected: all commands exit 0 and the worktree is clean.

- [ ] **Step 6: Merge the feature branch into local main**

Invoke `superpowers:finishing-a-development-branch`. Choose local merge, then:

```powershell
git switch main
git merge --ff-only codex/instant-corrections-dictionary-voice
```

Expected: fast-forward merge succeeds.

- [ ] **Step 7: Push main and monitor automated deployment**

```powershell
git push origin main
```

Then monitor GitHub deployment records until both the Vercel production deployment and `main - spoken-backend` deployment reference the new `main` SHA and report success.

- [ ] **Step 8: Verify public endpoints and UI**

Check:

```text
https://spokenai.org
https://spoken-gamma.vercel.app
https://spoken-backend.onrender.com/api/health
```

Expected:

- both frontend URLs return HTTP 200 and the same new asset build;
- health returns `{"status":"ok","app":"Spoken"}`;
- a public typed correction request returns structured JSON;
- a public dictionary lookup returns a Chinese entry;
- the public mobile UI shows the correction card and dictionary bottom sheet;
- automatic cloud speech plays one connected WAV.

- [ ] **Step 9: Record final evidence**

Report:

- final commit SHA;
- backend test count;
- frontend test count;
- lint/typecheck/build success;
- production deployment URLs and deployment SHA;
- real-audio samples checked;
- any known limitation that remains.
