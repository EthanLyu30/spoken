import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { WordCollector } from "./components/WordCollector";
import { Onboarding } from "./components/Onboarding";

// Route-level code splitting: each page ships as its own chunk and loads on
// navigation, so the initial bundle (Home) stays small. Heavy deps that only a
// few pages use — e.g. echarts on Profile/Progress — no longer weigh down first
// paint.
const Home = lazy(() => import("./pages/Home"));
const Conversation = lazy(() => import("./pages/Conversation"));
const Report = lazy(() => import("./pages/Report"));
const Progress = lazy(() => import("./pages/Progress"));
const WordBag = lazy(() => import("./pages/WordBag"));
const Profile = lazy(() => import("./pages/Profile"));
const Daily = lazy(() => import("./pages/Daily"));
const CustomScenePage = lazy(() => import("./pages/CustomScene"));
const Interview = lazy(() => import("./pages/Interview"));
const SessionView = lazy(() => import("./pages/SessionView"));

export default function App() {
  return (
    <>
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
      <WordCollector />
      <Onboarding />
    </>
  );
}
