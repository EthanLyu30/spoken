import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import Conversation from "./pages/Conversation";
import Report from "./pages/Report";
import Progress from "./pages/Progress";
import WordBag from "./pages/WordBag";
import Profile from "./pages/Profile";
import Daily from "./pages/Daily";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/practice/:scenarioId" element={<Conversation />} />
      <Route path="/report/:sessionId" element={<Report />} />
      <Route path="/progress" element={<Progress />} />
      <Route path="/words" element={<WordBag />} />
      <Route path="/me" element={<Profile />} />
      <Route path="/daily" element={<Daily />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
