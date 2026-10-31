import {afterEach,beforeEach,expect,it,vi} from "vitest";
beforeEach(()=>{vi.resetModules();localStorage.clear();});
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it.each(["getItem","setItem"] as const)("keeps a unique stable guest when storage %s fails",async(method)=>{
  vi.spyOn(Storage.prototype,method).mockImplementation(()=>{throw new Error("storage denied");});
  const first=await import("./clientId");
  const id=first.getClientId();
  expect(id).not.toBe("anon");expect(first.getClientId()).toBe(id);
  vi.resetModules();
  const second=await import("./clientId");
  expect(second.getClientId()).not.toBe(id);
});
it.each(["anon","ANON","u:1","   "])("replaces a reserved or empty persisted guest ID %s",async(id)=>{
  localStorage.setItem("spoken-client-id",id);
  const {getClientId}=await import("./clientId");
  const actual=getClientId();
  expect(actual).not.toBe(id);expect(actual.trim()).not.toBe("");
});
it("keeps an existing real guest identity if subsequent storage reads fail",async()=>{
  localStorage.setItem("spoken-client-id","existing-device");
  const {getClientId}=await import("./clientId");
  expect(getClientId()).toBe("existing-device");
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("storage denied");});
  expect(getClientId()).toBe("existing-device");
});
it("uses the new account token after overwrite failure and none after removal failure",async()=>{
  localStorage.setItem("spoken-token","old-account-token");
  const tokens=await import("./authToken");
  expect(tokens.getToken()).toBe("old-account-token");
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  tokens.setToken("new-account-token");
  expect(tokens.getToken()).toBe("new-account-token");
  vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw new Error("storage denied");});
  tokens.clearToken();expect(tokens.getToken()).toBeNull();
});
it("retains the current token in memory when storage later becomes unreadable",async()=>{
  const tokens=await import("./authToken");tokens.setToken("current-account-token");
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("storage denied");});
  expect(tokens.getToken()).toBe("current-account-token");
});
