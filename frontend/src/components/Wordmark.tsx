import { Link } from "react-router-dom";
export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Spoken 首页">
      <img src="/images/pip.png" alt="" />
      <span>Spoken</span>
    </Link>
  );
}
