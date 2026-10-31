import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveVoiceMode } from "../lib/voiceResolver";
beforeEach(() => { vi.resetModules(); localStorage.removeItem("spoken-voice"); });
afterEach(() => localStorage.removeItem("spoken-voice"));

it("routes a new user's default to native speech when an English device voice exists", async () => {
  const {useVoice}=await import("./voice");
  expect(await resolveVoiceMode(useVoice.getState().engine,{listEnglishVoices:()=>[{lang:"en-US"} as SpeechSynthesisVoice],subscribe:()=>()=>{},timeoutMs:1})).toEqual({kind:"browser"});
});
it("migrates old cloud defaults to browser while retaining voice and speed preferences", async () => {
  localStorage.setItem("spoken-voice",JSON.stringify({version:0,state:{engine:"iflytek",vcn:"henry",speed:40,pitch:60,browserVoiceURI:null}}));
  const {useVoice}=await import("./voice"); await useVoice.persist.rehydrate();
  expect(useVoice.getState()).toMatchObject({engine:"browser",vcn:"henry",speed:40,pitch:60});
});
it("retains an explicitly selected local model during preference migration", async () => {
  localStorage.setItem("spoken-voice",JSON.stringify({version:0,state:{engine:"local",speed:45}}));
  const {useVoice}=await import("./voice"); await useVoice.persist.rehydrate();
  expect(useVoice.getState()).toMatchObject({engine:"local",speed:45});
});

it("retains a cloud choice made after the new default migration across reloads", async () => {
  const first=await import("./voice"); first.useVoice.getState().setEngine("iflytek");
  vi.resetModules();
  const next=await import("./voice"); await next.useVoice.persist.rehydrate();
  expect(next.useVoice.getState().engine).toBe("iflytek");
});
