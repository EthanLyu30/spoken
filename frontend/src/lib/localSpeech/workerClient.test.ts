import {afterEach,describe,expect,it,vi} from "vitest";
import {LocalModelWorkerClient} from "./workerClient";

class FakeWorker {
  listeners=new Map<string,EventListener>();
  postMessage=vi.fn();
  terminate=vi.fn();
  addEventListener(type:string,listener:EventListener){this.listeners.set(type,listener);}
  removeEventListener(type:string){this.listeners.delete(type);}
  emit(data:unknown){this.listeners.get("message")?.({data} as MessageEvent);}
}
afterEach(()=>vi.useRealTimers());
describe("local worker recovery",()=>{
  it("forwards model progress without confusing it with an RPC result",async()=>{
    const worker=new FakeWorker();
    const client=new LocalModelWorkerClient(()=>worker as unknown as Worker);
    const report=vi.fn();
    const unsubscribe=client.subscribeProgress(report);
    const request=client.request("load");
    worker.emit({type:"progress",model:"kokoro",progress:{file:"model.onnx",loaded:100}});
    expect(report).toHaveBeenCalledWith({file:"model.onnx",loaded:100});
    worker.emit({id:1,ok:true});
    await request;
    unsubscribe(); client.dispose();
  });
  it("kills timed-out work, rejects queued requests and creates a fresh worker for retry",async()=>{
    vi.useFakeTimers();
    const first=new FakeWorker(),second=new FakeWorker();
    const factory=vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client=new LocalModelWorkerClient(factory);
    const timed=client.request("synthesize",{},[],2000);
    const queued=client.request("load");
    const results=Promise.allSettled([timed,queued]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect((await results).map(result=>result.status)).toEqual(["rejected","rejected"]);
    const retry=client.request("load");
    second.emit({id:3,ok:true,result:"ready"});
    expect(await retry).toBe("ready");
    client.dispose();
  });
  it("discards a failed model worker so retry cannot reuse its failed cached model",async()=>{
    const worker=new FakeWorker();
    const client=new LocalModelWorkerClient(()=>worker as unknown as Worker);
    const failed=client.request("load");
    worker.emit({id:1,ok:false,error:"model download failed"});
    await expect(failed).rejects.toThrow("model download failed");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
