import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { DictionaryProvider } from "./components/dictionary/DictionaryProvider";
import { Onboarding } from "./components/Onboarding";
import { AppHeader } from "./components/AppHeader";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { SiteVisitTracker } from "./components/SiteVisitTracker";
import { SpeechPlaybackError } from "./components/SpeechPlaybackStatus";
import { useAuth } from "./store/auth";
import Home from "./pages/Home";

// Route-level code splitting keeps deep pages out of the first request. Home is
// eager because it is the landing route: lazy-loading it added a chunk waterfall
// before the first stats/scenario requests could start. Heavy deps that only a
// few pages use — e.g. echarts on Profile/Progress — stay split.
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
  const generation = useAuth((s) => s.generation);
  const user = useAuth((s) => s.user);
  const resolving = useAuth((s) => s.resolving);
  const resolutionError = useAuth((s) => s.resolutionError);
  const focused = location.pathname.startsWith("/practice/");
  const section = location.pathname.split("/")[1] || "home";
  // Account resolution must never hide the routes: Home, Scenes and practice
  // remain usable while `/auth/me` validates in the background. Only an
  // unresolved credential shows a non-blocking notice.
  const authNotice = resolving || (resolutionError && !user);
  return (
    <DictionaryProvider key={generation}>
      <SiteVisitTracker />
      <SpeechPlaybackError />
      <div className={`app-route route-${section}`}>
        {authNotice && (
          <div
            className={`auth-notice${resolutionError ? " auth-notice-error" : ""}`}
            role={resolutionError ? "alert" : "status"}
          >
            <span>
              {resolutionError
                ? "账户信息暂时无法确认，你仍可继续以游客身份练习。"
                : "正在确认账户…"}
            </span>
            {resolutionError && (
              <>
                <button type="button" onClick={() => void useAuth.getState().refresh()}>
                  重试
                </button>
                <button type="button" onClick={() => useAuth.getState().logout()}>
                  退出账户
                </button>
              </>
            )}
          </div>
        )}
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
