import { Map, WandSparkles } from "lucide-react";
import { NavLink } from "react-router-dom";

export function SceneTabs() {
  return (
    <nav className="scene-tabs" aria-label="场景练习方式">
      <NavLink to="/scenes">
        <Map />
        闯关地图
      </NavLink>
      <NavLink to="/custom">
        <WandSparkles />
        自定义场景
      </NavLink>
    </nav>
  );
}
