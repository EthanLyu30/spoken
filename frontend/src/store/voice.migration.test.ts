import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveVoiceMode } from "../lib/voiceResolver";
beforeEach(() => { vi.resetModules(); localStorage.removeItem("spoken-voice"); });
afterEach(() => localStorage.removeItem("spoken-voice"));

it.each([0,1,2])("migrates version %i cloud preferences to browser while preserving personal settings",async version=>{
  localStorage.setItem("spoken-voice",JSON.stringify({version,state:{engine:"iflytek",vcn:"henry",browserVoiceURI:"google-en",speed:42,pitch:53}}));
  const {useVoice}=await import("./voice");
  expect(useVoice.getState()).toMatchObject({engine:"browser",browserVoiceURI:"google-en",speed:42,pitch:53});
});
it.each([0,1,2])("retains explicit local mode from version %i",async version=>{
  localStorage.setItem("spoken-voice",JSON.stringify({version,state:{engine:"local",browserVoiceURI:"device",speed:45,pitch:60}}));
  const {useVoice}=await import("./voice");
  expect(useVoice.getState()).toMatchObject({engine:"local",browserVoiceURI:"device",speed:45,pitch:60});
});
it("migrates an unknown engine to browser",async()=>{
  localStorage.setItem("spoken-voice",JSON.stringify({version:2,state:{engine:"future-cloud",speed:41}}));
  const {useVoice}=await import("./voice");
  expect(useVoice.getState()).toMatchObject({engine:"browser",speed:41});
});
it("routes a new user's default to native speech when an English device voice exists", async () => {
  const {useVoice}=await import("./voice");
  expect(await resolveVoiceMode(useVoice.getState().engine,{listEnglishVoices:()=>[{lang:"en-US"} as SpeechSynthesisVoice],subscribe:()=>()=>{},timeoutMs:1})).toEqual({kind:"browser"});
});
it("retains explicit local mode and personal settings across reloads",async()=>{
  const first=await import("./voice"); first.useVoice.getState().setEngine("local"); first.useVoice.getState().setBrowserVoiceURI("chosen");
  vi.resetModules(); const next=await import("./voice");
  expect(next.useVoice.getState()).toMatchObject({engine:"local",browserVoiceURI:"chosen"});
});
