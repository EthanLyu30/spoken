import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { DictionaryProvider } from "./components/dictionary/DictionaryProvider";
import { Onboarding } from "./components/Onboarding";
import { AppHeader } from "./components/AppHeader";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { SiteVisitTracker } from "./components/SiteVisitTracker";

// Route-level code splitting: each page ships as its own chunk and loads on
// navigation, so the initial bundle (Home) stays small. Heavy deps that only a
// few pages use — e.g. echarts on Profile/Progress — no longer weigh down first
// paint.
const Home = lazy(() => import("./pages/Home"));
const Scenes = lazy(() => import("./pages/Scenes"));
const Conversation = lazy(() => import("./pages/Conversation"));
const Report = lazy(() => import("./pages/Report"));
const Progress = lazy(() => import("./pages/Progress"));
const WordBag = lazy(() => import("./pages/WordBag"));
const Profile = lazy(() => import("./pages/Profile"));
const Daily = lazy(() => import("./pages/Daily"));
const CustomScenePage = lazy(() => import("./pages/CustomScene"));
const Interview = lazy(() => import("./pages/Interview"));
const SessionView = lazy(() => import("./pages/SessionView"));
const Admin = lazy(() => import("./pages/Admin"));

export default function App() {
  const location = useLocation();
  const focused = location.pathname.startsWith("/practice/");
  const section = location.pathname.split("/")[1] || "home";
  return (
    <DictionaryProvider>
      <SiteVisitTracker />
      <div className={`app-route route-${section}`}>
        {!focused && <AppHeader />}
        <RouteErrorBoundary key={location.pathname}>
        <Suspense
          fallback={
            <div role="status" className="route-loading">
              正在打开页面…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/scenes" element={<Scenes />} />
            <Route path="/custom" element={<CustomScenePage />} />
            <Route path="/interview" element={<Interview />} />
            <Route
              path="/practice/:scenarioId"
              element={<Conversation key={location.pathname} />}
            />
            <Route path="/report/:sessionId" element={<Report />} />
            <Route path="/session/:id" element={<SessionView />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/words" element={<WordBag />} />
            <Route path="/me" element={<Profile />} />
            <Route path="/daily" element={<Daily />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <Onboarding />
      </div>
    </DictionaryProvider>
  );
}
