import {afterEach,expect,it,vi} from "vitest";

class StallWorker {
  listeners=new Map<string,EventListener>();
  terminate=vi.fn();
  addEventListener(type:string,listener:EventListener){this.listeners.set(type,listener);}
  removeEventListener(type:string){this.listeners.delete(type);}
  postMessage(message:{id:number;type:string}){
    if(message.type === "load") queueMicrotask(()=>this.listeners.get("message")?.({data:{id:message.id,ok:true}} as MessageEvent));
  }
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each([
  {model:"kokoro",budget:2000},
  {model:"moonshine",budget:5000},
])("bounds stalled $model inference so the conversation can fall back",async({model,budget})=>{
  vi.resetModules();vi.useFakeTimers();vi.stubGlobal("Worker",StallWorker);
  const kokoro=await import("./kokoro");
  const moonshine=await import("./moonshine");
  await (model === "kokoro" ? kokoro.loadKokoroModel() : moonshine.loadMoonshineModel());
  const promise=model === "kokoro" ? kokoro.synthesizeWithKokoro("A full reply.") : moonshine.transcribeWithMoonshine(new ArrayBuffer(16));
  const rejected=expect(promise).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(budget);
  await rejected;
});
