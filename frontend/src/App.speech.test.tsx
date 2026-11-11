import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./components/SiteVisitTracker",()=>({SiteVisitTracker:()=>null}));
vi.mock("./components/AppHeader",()=>({AppHeader:()=>null}));
vi.mock("./components/Onboarding",()=>({Onboarding:()=>null}));
vi.mock("./lib/api",async actual=>({...await actual<object>(),postDictionaryLookup:vi.fn(async(query:string)=>({query,meaning:"解释",example:"An example.",example_zh:"例子"}))}));
vi.mock("./lib/localSpeech/runtime",()=>({isLocalSpeechModelReady:()=>false,localSpeechCoordinator:{markError:vi.fn()}}));
import App from "./App";
import { clearToken } from "./lib/authToken";
import { stopSpeaking } from "./lib/speech";
import { clearDictionarySessionCache } from "./lib/dictionary";
import { useAuth } from "./store/auth";
import { useWords } from "./store/words";
import { useVoice } from "./store/voice";
import { useSpeechPlayback } from "./store/speechPlayback";
class Utterance {
  onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:((event:{error:string})=>void)|null=null;
  constructor(public text:string){}
}
const utterances:Utterance[]=[];
let voices:SpeechSynthesisVoice[]=[];
let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  clearToken();useAuth.setState({user:null,resolving:false,resolutionError:false});
  useWords.setState({words:[],fetchedOnce:true});useVoice.setState({engine:"browser",browserVoiceURI:null});
  useSpeechPlayback.setState({playback:null});clearDictionarySessionCache();utterances.length=0;voices=[];
  vi.stubGlobal("SpeechSynthesisUtterance",Utterance);
  vi.stubGlobal("speechSynthesis",{getVoices:()=>voices,addEventListener:vi.fn(),removeEventListener:vi.fn(),cancel:vi.fn(),speak:(u:Utterance)=>utterances.push(u)});
  fetcher=vi.fn(async()=>new Response(null,{status:202}));vi.stubGlobal("fetch",fetcher);
});
afterEach(()=>{stopSpeaking();vi.unstubAllGlobals();useSpeechPlayback.setState({playback:null});});
async function openDaily(){
  render(<MemoryRouter initialEntries={["/daily"]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><App/></MemoryRouter>);
  await screen.findByRole("heading",{name:"今天，带走五句好表达。"},{timeout:3000});
}
function expectNoCloudTts(){expect(fetcher.mock.calls.map(([url])=>String(url)).some(url=>url.includes("/api/tts"))).toBe(false);}
it("surfaces missing English voices from Daily, dismisses the error, and shows a fresh attempt again",async()=>{
  await openDaily();fireEvent.click(screen.getAllByRole("button",{name:"朗读"})[0]);
  await waitFor(()=>expect(useSpeechPlayback.getState().playback?.phase).toBe("error"));
  expect(screen.getByRole("alert")).toHaveTextContent("浏览器尚未提供英语音色");
  fireEvent.click(screen.getByRole("button",{name:"关闭朗读错误提示"}));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button",{name:"朗读"})[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("浏览器尚未提供英语音色");expectNoCloudTts();
}, 15000);
it("surfaces a real native startup failure from the dictionary overlay without closing it",async()=>{
  voices=[{name:"English",voiceURI:"en",lang:"en-US"} as SpeechSynthesisVoice];
  await openDaily();fireEvent.click(screen.getAllByRole("button",{name:/^查询 /})[0]);
  const dialog=await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button",{name:"朗读"}));
  await waitFor(()=>expect(utterances).toHaveLength(1));
  act(()=>utterances[0].onerror?.({error:"synthesis-unavailable"}));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("朗读启动失败");
  expect(alert).toHaveTextContent("重试");
  expect(alert).toHaveTextContent("更换英语音色");
  expect(alert).not.toHaveTextContent("浏览器尚未提供英语音色");
  expect(dialog).toBeVisible();expectNoCloudTts();
});
it("places the shared error inside an open native modal and removes it on successful playback",async()=>{
  voices=[{name:"English",voiceURI:"en",lang:"en-US"} as SpeechSynthesisVoice];
  await openDaily();const dialog=document.createElement("dialog");dialog.open=true;document.body.append(dialog);
  try {
    fireEvent.click(screen.getAllByRole("button",{name:"朗读"})[0]);await waitFor(()=>expect(utterances).toHaveLength(1));
    act(()=>utterances[0].onerror?.({error:"synthesis-unavailable"}));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("朗读启动失败");
    fireEvent.click(within(dialog).getByRole("button",{name:"关闭朗读错误提示"}));expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button",{name:"朗读"})[0]);await waitFor(()=>expect(utterances).toHaveLength(2));
    await act(async()=>{utterances[1].onstart?.();utterances[1].onend?.();});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();expectNoCloudTts();
  } finally {dialog.remove();}
});

