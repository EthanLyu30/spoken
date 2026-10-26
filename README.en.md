<div align="center">

# 🗣️ Spoken — AI English Speaking Coach

**Practice spoken English with an AI partner in real-life scenarios, and get quantified feedback on pronunciation, grammar and expression.**

[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)]()
[![Frontend](https://img.shields.io/badge/frontend-React%2BTS-61dafb)]()
[![Voice](https://img.shields.io/badge/voice-iFlytek-blue)]()
[![LLM](https://img.shields.io/badge/LLM-DeepSeek-7c3aed)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

English · [中文](README.md)

</div>

---

## Overview

Spoken is an **AI English speaking coach** for Chinese learners. Pick a real-life
scenario (job interview, a business negotiation, ordering coffee, a doctor's
visit…) and talk — by voice
or text — with the AI buddy **Pip**. During and after the chat, the app scores
your **pronunciation, grammar and expression**, and turns every session into a
growth curve.

## Highlights

- **Fast/slow dual-path architecture** with **streaming chat replies** — the
  conversation stays snappy while assessment runs asynchronously.
- **iFlytek voice pipeline** — streaming ASR, pronunciation scoring and
  streamed PCM playback by default for new users. Device voices and local
  Moonshine/Kokoro models are optional; models download only after opting in.
  Call mode provides live captions and preserves the beginning of barge-in
  speech. AudioWorklet capture has a compatibility fallback. Alternatively,
  tap to record, tap again to finish, and send the transcription automatically.
- **Instant feedback on every learner turn** — Pip replies first, then the learner
  can open grammar / expression correction, a natural rewrite and explanation;
  voice turns can also request pronunciation feedback without persisting audio.
- **Dictionary in context** — click an English word or select a two-to-six-word
  phrase for a Chinese definition, example and translation, then collect it
  directly. Desktop uses an anchored card; mobile uses a bottom sheet.
- **Take an Interview practice** — four 45-second answers covering experiences,
  reasons and opinions, with transcript-based practice scores, suggestions and
  sample answers. Failed recognition can be recorded again.
- **Quotes you can actually use** — movies / speeches·TED / literature / people /
  proverbs, each with a **verified source** (checked against Wikiquote, apocryphal
  ones removed) and a **"when to use it"** note.
- **Custom & daily-generated scenarios** — describe an English-practice scene in one line, or play
  the daily AI recommendation.
- **Speaking-only boundaries** — unrelated coding, debugging, homework and
  long-form writing tasks are declined, with a short invitation back to English
  practice. Technical vocabulary and normal workplace conversation remain
  available. Explicit tasks are rejected locally; other inputs use the shared
  dialogue policy, without an extra AI classification call.
- **Real progress data** — streak / level / XP / daily goal, pronunciation & Q&A
  history charts, and a **cross-session insight** that points at your weakest
  dimension and whether each skill is climbing — all driven by real activity.
  Each post-session debrief exports to **PDF in one tap**.
- **Resilient** — request timeouts, streaming fallback, and voice-call
  auto-reconnect; 60+ backend tests.

## Architecture

A **cascaded pipeline** (not an end-to-end speech model), because pronunciation
scoring and grammar correction need the intermediate structured data (transcript,
phoneme-level scores). The key idea is decoupling a low-latency path from an
asynchronous assessment path:

```
            ┌──────── fast path (low latency) ────────┐
 🎤 mic ─VAD─► ASR (live) ──► chat LLM (streamed) ──► TTS (browser/iFlytek) ─► 🔊
                 │
                 └─► transcript ─┐
                                 ├─► slow path (async, non-blocking)
 end of chat ─────────────────────┴─► pronunciation + grammar + debrief ─► 📊
```

> Current state: chat uses explicit streaming delta, completion and error events. Cloud TTS relays PCM frames for playback before the full audio is generated. Unique practice IDs make retries idempotent; long conversations retain their transcript while model context stays bounded. Full design in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Stack

- **Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · Zustand · ECharts.
- **Backend:** Python 3.11 · FastAPI · WebSocket · SQLAlchemy · SQLite.
- **ASR / pronunciation:** iFlytek (IAT + ISE). **TTS:** iFlytek streaming PCM
  by default; device voices and local models are optional. **LLM:** DeepSeek (`deepseek-flash`, follows the latest Flash release, thinking disabled, streamed; Pro is disallowed).

## Quick start

Requires **Python 3.11+** and **Node.js 18+**.

```bash
# Backend (http://127.0.0.1:8000)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # set DEEPSEEK_API_KEY (required), XF_* (voice)
uvicorn app.main:app --reload

# Frontend (http://localhost:5173), in another terminal
cd frontend
npm install
npm run dev
```

With **only `DEEPSEEK_API_KEY`** you get text chat, timed Q&A scoring, quotes and
custom scenarios. Configure `XF_*` for the default cloud voice pipeline and
pronunciation scoring, or select device speech in voice settings. Set a private,
stable `JWT_SECRET` for production and multi-worker deployments.

## License

[MIT](LICENSE) © 2026 Xiaoyang Lyu (EthanLyu30)
