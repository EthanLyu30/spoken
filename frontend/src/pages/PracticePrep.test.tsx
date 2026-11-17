import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import PracticePrep from "./PracticePrep";

vi.mock("../components/dictionary/InteractiveEnglishText", () => ({ InteractiveEnglishText: ({ text }: { text: string }) => <span>{text}</span> }));

function PracticeDestination() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}

it("lets a learner review fixed airport phrases and bring the article focus into the conversation", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/prepare/airport?focus=articles"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
    <Route path="/practice/:scenarioId" element={<PracticeDestination />} />
  </Routes></MemoryRouter>);
  const focus = screen.getByRole("region", { name: "专项复练 · 冠词" });
  expect(within(focus).getByText(/check ___ bag/)).toBeVisible();
  expect(screen.getByRole("region", { name: "关键词与句型" })).toHaveTextContent("check a bag");
  await user.click(within(focus).getByText("查看参考说法"));
  expect(within(focus).getByText("I need to check a bag.")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "开始场景练习" }));
  expect(screen.getByText("/practice/airport?focus=articles")).toBeVisible();
});
