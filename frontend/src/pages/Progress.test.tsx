import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PracticeRecord } from "../lib/api";

const mock = vi.hoisted(() => ({ records: [] as PracticeRecord[] }));
vi.mock("../hooks/useProgressData", () => ({ useProgressData: () => ({
  sessions: [], practice: mock.records, stats: null, insights: null, latest: null,
  status: "ready", errors: [], practicePending: false, statsPending: false, reload: vi.fn(),
}) }));
vi.mock("../components/EChart", () => ({ EChart: () => null }));
import Progress from "./Progress";
import * as api from "../lib/api";
import { useAuth } from "../store/auth";
vi.mock("../components/InterviewResults", () => ({InterviewResults: ({result}: {result:api.InterviewScore}) => <p>{result.results[0].question}</p>}));
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});});
afterEach(()=>vi.restoreAllMocks());

const record = (id: number, score: number, score_max?: number): PracticeRecord => ({
  id, kind: "interview", score, score_max, title: `访谈记录${id}`, created_at: "2026-10-30T02:00:00Z",
});
function show() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Progress /></MemoryRouter>);
}
beforeEach(() => { mock.records = []; useAuth.setState({user:null}); });

it("shows mixed history in native scales while averaging only the new rubric", () => {
  mock.records = [record(1, 6), record(2, 3, 5), record(3, 5, 5)];
  show();
  const metric = screen.getByText("近期访谈内容均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4")).toBeVisible();
  expect(within(metric).getByText("/ 5")).toBeVisible();
  expect(within(metric).getByText(/旧版 1 次未混入/)).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录1/ })).getByText("/ 6")).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录2/ })).getByText("/ 5")).toBeVisible();
});

it("keeps an all-legacy average explicitly labelled six-point", () => {
  mock.records = [record(1, 6), record(2, 3)];
  show();
  const metric = screen.getByText("旧版访谈均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4.5")).toBeVisible();
  expect(within(metric).getByText("/ 6")).toBeVisible();
});

const detail = (id:number) => ({...record(id,4,5),detail:JSON.stringify({overall:4,results:[{question:`detail-${id}`,answer:"answer",score:4,feedback:"feedback",sample_answer:"sample"}]})});
function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(error:Error)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};
}
it("keeps the most recently selected history when requests complete in reverse order",async()=>{
  mock.records=[record(1,4,5),record(2,4,5)];
  const first=deferred<api.PracticeDetail>();
  vi.spyOn(api,"getPracticeDetail").mockReturnValueOnce(first.promise).mockResolvedValueOnce(detail(2));
  show();fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));fireEvent.click(screen.getByRole("button",{name:/访谈记录2/}));
  await screen.findByText("detail-2");await act(async()=>{first.resolve(detail(1));});
  expect(screen.getByText("detail-2")).toBeVisible();expect(screen.queryByText("detail-1")).not.toBeInTheDocument();
});
it("does not let an older failure clear the active history loading or show an error",async()=>{
  mock.records=[record(1,4,5),record(2,4,5)];
  const first=deferred<api.PracticeDetail>(),second=deferred<api.PracticeDetail>();
  vi.spyOn(api,"getPracticeDetail").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  show();fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));fireEvent.click(screen.getByRole("button",{name:/访谈记录2/}));
  await act(async()=>{first.reject(new Error("offline"));});
  expect(screen.getByRole("button",{name:/访谈记录2/})).toBeDisabled();
  expect(screen.queryByText(/这条旧记录/)).not.toBeInTheDocument();
  await act(async()=>{second.resolve(detail(2));});expect(screen.getByText("detail-2")).toBeVisible();
});
it("cancels history work on owner change even when transport ignores cancellation",async()=>{
  mock.records=[record(1,4,5)];const first=deferred<api.PracticeDetail>();
  const request=vi.spyOn(api,"getPracticeDetail").mockReturnValue(first.promise);
  const view=render(<MemoryRouter><Progress /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));
  act(()=>useAuth.setState({user:{id:927,email:"changed@example.test",display_name:"",avatar_url:"",created_at:""}}));
  expect(request.mock.calls[0][1]?.aborted).toBe(true);
  await act(async()=>{first.reject(new Error("offline"));});
  expect(screen.queryByText(/这条旧记录/)).not.toBeInTheDocument();
  view.unmount();
});
