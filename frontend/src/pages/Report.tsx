import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Report() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-page px-6 py-8 lg:px-20">
        <Link to="/" className="eyebrow inline-flex w-max items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回 · Home
        </Link>

        <p className="eyebrow mt-10">Post-session Debrief · 课后报告</p>
        <h1 className="mt-3 text-4xl md:text-5xl">
          Your <span className="hl-static">debrief</span> spread
        </h1>
        <p className="mt-4 max-w-reading font-sc text-muted">
          发音雷达、语法纠错与能力趋势的杂志式报告即将上线。
        </p>
      </div>
    </div>
  );
}
