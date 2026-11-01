import { Link } from "react-router-dom";
import pip96 from "../assets/pip-96.webp";
import pip192 from "../assets/pip-192.webp";
export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Spoken 首页">
      <img src={pip96} srcSet={`${pip96} 96w, ${pip192} 192w`} sizes="49px" width={49} height={59} alt="" />
      <span>Spoken</span>
    </Link>
  );
}
