# 游客练习进度迁移到新账号：修复与浏览器验收

日期：2026-11-09  
分支：`review/three-workstreams-20261109`  
基线：`42f10ba9532d259d8231b9b9c29ec0a867251780`（main，900ms 判停已发布）

## 结论

修复了两个会导致“游客刚完成的练习在注册后消失”的问题：

1. **账号创建与游客数据认领不是同一事务。** 注册先提交账号，再单独认领游客数据；认领失败时账号已存在，重试会得到“邮箱已注册”，但进度没有迁移。
2. **注册切换身份前没有等待正在保存的游客写入。** 前端在 token 切换时会重置 owner 状态；如果保存请求还在途中，结果可能被丢弃或在切换后失败。

修复后，本地浏览器验收中，延迟 1.2s 的游客 session 保存在注册切号前完成，注册后该 session、interview practice、word/review 均在新账号可见，旧游客读不到。后端全量 644 项、前端全量 581 项通过。

## 修改

### 后端：账号与认领原子化

- `backend/app/services/users.py`
  - `create_user(..., commit=True)` 增加关键字参数；`commit=False` 时只 `add` + `flush`，由调用方统一提交。
- `backend/app/api/auth.py`
  - 注册改为 `create_user(..., commit=False)` → `claim_device_data` → `db.commit()` / `db.refresh(user)`。
  - 认领抛错时事务回滚，未提交的账号也一并回滚；同一邮箱可重试。
- `backend/tests/test_auth.py`
  - `test_register_rolls_back_account_when_claim_fails`：认领失败后无 User 行，重试注册返回 201。
  - `test_register_claims_all_saved_guest_progress`：游客 session、interview practice、word/review 注册后归属新账号，旧游客不可见。

### 前端：注册前 flush 游客写入

- `frontend/src/lib/api.ts`
  - 跟踪 `/api/(sessions|practice|words)` 的非 GET 请求到 `pendingWrites`。
  - `flushPendingWrites()` 等待所有已跟踪请求 settle；保留 50ms 的同一轮排队窗口。
- `frontend/src/store/auth.ts`
  - `register()` 先 `await flushPendingWrites()`，再调用注册接口，并在返回后检查操作序号/generation，避免把旧账号的响应写回新账号。
- `frontend/src/lib/pendingWrites.test.ts`
  - 延迟 `/api/sessions` POST，断言 flush 会等待该请求。

## 浏览器验收

环境：本地 FastAPI `127.0.0.1:8011` + SQLite 测试库；Vite `127.0.0.1:5174`；Chrome 156，测试 profile 使用 `--disable-web-security` 仅绕过本地 5174→8011 的 CORS（产品 CORS 未改）。

流程：

1. 设置唯一游客 `X-Client-Id`。
2. 以游客身份保存一个 scenario session、一个 interview practice、一个 word 及 review。
3. 拦截 `/api/sessions` POST，延迟 1.2s。
4. 发起一个延迟保存，同时调用注册。
5. 注册完成后查询新账号的 sessions/practice/words/stats，并用旧游客 ID 查询 sessions。

结果（同一 app 模块实例）：

```json
{
  "order": {
    "registerStarted": 3190.4,
    "saveStarted": 3190.7,
    "saveFinished": 4426.0,
    "registerFinished": 4508.1,
    "saveAfterRegister": false
  },
  "sessionVisible": true,
  "lateSessionVisible": true,
  "practiceVisible": true,
  "wordVisible": true,
  "stats": {"sessions": 2, "practice": 1, "words": 1},
  "oldGuestSessions": []
}
```

说明：

- `saveFinished < registerFinished`：注册等待了延迟保存。
- `lateSessionVisible=true`：延迟保存的 session 也归属新账号。
- `oldGuestSessions=[]`：旧游客不能再读已迁移 session。
- 首次浏览器脚本因动态 import 生成了**另一个模块实例**，`pendingWrites` 不是 app 使用的集合，出现 `AbortError: Account changed`；这是验收脚本的模块重复问题，不是产品行为。改用 app 注入的同一模块实例后得到上表结果。临时 debug 注入已删除，提交不包含。

## 验证

- 后端：`644 passed`（2026-11-09）。
- 前端：`73 files / 581 tests passed`。
- `npm run typecheck`：通过。
- 浏览器验收：上表。
- 未跑真实邮件、真实网络丢包、双标签并发。

## 未覆盖 / 风险

- 账号创建成功但客户端没收到注册响应：需要重试时识别“邮箱已注册且游客数据已认领”，本轮未做恢复 UI。
- 认领失败的真实浏览器流程（后端 5xx、网络中断）未做故障注入；单元测试覆盖事务回滚。
- 双标签/双击注册、旧请求晚到覆盖新账号、logout/relogin 后历史刷新未验收。
- 读/面试/词汇等历史页面在新账号下的逐页展示未全量走查；接口层已验收。
- 数据库/API 变更的旧前端兼容：本轮只增加内部 `commit` 参数，注册响应形状未变；后端可先部署。回滚后端单提交即可，前端 flush 可独立回滚。

## 复跑

```bash
# 后端
cd backend
.\.venv\Scripts\python.exe -m pytest tests/test_auth.py -q
.\.venv\Scripts\python.exe -m pytest -q

# 前端
cd frontend
npm run typecheck
npm test -- --run src/lib/pendingWrites.test.ts
npm test -- --run
```

浏览器脚本为临时验收工具，不提交；证据中的 token、邮箱、JWT、请求头均已脱敏。
