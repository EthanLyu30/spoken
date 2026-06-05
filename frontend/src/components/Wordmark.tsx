import { Link } from "react-router-dom";

/** App logo: a tiny Pip face in a coral badge next to the wordmark. */
export function Wordmark() {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-coral shadow-soft">
        <svg width="24" height="24" viewBox="0 0 22 22">
          <circle cx="8" cy="10" r="2.1" fill="#fffdf9" />
          <circle cx="14" cy="10" r="2.1" fill="#fffdf9" />
          <circle cx="8.4" cy="10.3" r="0.95" fill="#43302b" />
          <circle cx="14.4" cy="10.3" r="0.95" fill="#43302b" />
          <path d="M8 14 q3 2.5 6 0" stroke="#fffdf9" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </span>
      <span className="font-display text-xl font-semibold text-ink">Spoken</span>
    </Link>
  );
}
