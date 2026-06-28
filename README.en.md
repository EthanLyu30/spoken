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
scenario (job interview, ordering coffee, a doctor's visit…) and talk — by voice
or text — with the AI buddy **Pip**. During and after the chat, the app scores
your **pronunciation, grammar and expression**, and turns every session into a
growth curve.

## Highlights

- **Fast/slow dual-path architecture** with **streaming chat replies** — the
  conversation stays snappy while assessment runs asynchronously.
- **Full iFlytek voice stack** — speech recognition (ASR), pronunciation scoring
  (ISE) and TTS; read-aloud offers a **browser-native voice (default) or iFlytek**,
  with adjustable speed / pitch / voice. Talk hands-free in **call mode** with
  **live captions** (streaming ASR) or use **push-to-talk** (which auto-sends what
  it hears — no extra tap).
- **TOEFL-style timed Q&A** — a real TOEFL independent-speaking question bank plus
  AI scenario questions; 45s per answer, scored on the ETS rubric with a model
  high-scoring sample answer.
- **Quotes you can actually use** — movies / speeches·TED / literature / people /
  proverbs, each with a **verified source** (checked against Wikiquote, apocryphal
  ones removed) and a **"when to use it"** note.
- **Custom & daily-generated scenarios** — describe any scene in one line, or play
  the daily AI recommendation.
- **Real progress data** — streak / level / XP / daily goal, pronunciation & Q&A
  history charts, and a **cross-session insight** that points at your weakest
  dimension and whether each skill is climbing — all driven by real activity.
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

> Current state: chat replies are **streamed**; in call mode **read-aloud is streamed sentence-by-sentence** (the first sentence starts playing while the rest is still being generated and synthesised, cutting perceived latency) and **ASR is streamed live** (captions appear and self-correct as you speak, and the reply starts the instant you stop — falling back to buffered transcription if the relay is unavailable); read-aloud defaults to the browser-native voice with iFlytek optional. Full design in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Stack

- **Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · Zustand · ECharts.
- **Backend:** Python 3.11 · FastAPI · WebSocket · SQLAlchemy · SQLite.
- **ASR / pronunciation:** iFlytek (IAT + ISE). **TTS:** browser Web Speech API
  (default) or iFlytek. **LLM:** DeepSeek (`deepseek-chat`, streamed).

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

With **only `DEEPSEEK_API_KEY`** you get text chat, timed Q&A, quote generation and
custom scenarios, and read-aloud works via the **browser voice** (no iFlytek needed).
Add `XF_*` to unlock speech recognition, pronunciation scoring and iFlytek voices.

## License

[MIT](LICENSE) © 2026 Xiaoyang Lyu (EthanLyu30)
