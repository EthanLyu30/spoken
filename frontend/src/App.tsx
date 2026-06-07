import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import Conversation from "./pages/Conversation";
import Report from "./pages/Report";
import Progress from "./pages/Progress";
import WordBag from "./pages/WordBag";
import Profile from "./pages/Profile";
import Daily from "./pages/Daily";
import CustomScenePage from "./pages/CustomScene";
import Interview from "./pages/Interview";
import SessionView from "./pages/SessionView";
import { WordCollector } from "./components/WordCollector";
import { Onboarding } from "./components/Onboarding";

export default function App() {
  return (
    <>
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
      <WordCollector />
      <Onboarding />
    </>
  );
}
