import pip from "../assets/pip-192.webp";
import "./RewardAvatar.css";

export function RewardAvatar({ size }: { size?: number }) {
  return <span className="reward-avatar" role="img" aria-label="围巾 Pip 头像" style={size ? { width: size, height: size } : undefined}>
    <img src={pip} alt="" />
    <span aria-hidden="true" />
  </span>;
}
