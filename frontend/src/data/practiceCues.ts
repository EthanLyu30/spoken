import type { CustomScene } from "../lib/api";

type PracticeCue = readonly [keyword: string, meaning: string, sentence: string];

const general: readonly PracticeCue[] = [
  ["Could you help me with…?", "说明来意", "Could you help me with something?"],
  ["Could you say that again?", "请对方再说一次", "Could you say that again, please?"],
  ["Just to confirm…", "复述并确认下一步", "Just to confirm, what should I do next?"],
];

const byScene: Record<string, readonly PracticeCue[]> = {
  cafe: [
    ["a latte", "点一杯拿铁", "I'd like a latte, please."],
    ["oat milk", "问能否换燕麦奶", "Can I get it with oat milk?"],
    ["pay by card", "结账时问能否刷卡", "Can I pay by card?"],
  ],
  airport: [
    ["check in", "办理登机", "I'd like to check in for my flight."],
    ["check a bag", "托运一件行李", "I need to check a bag."],
    ["boarding gate", "确认登机口", "Could you tell me which gate my flight leaves from?"],
  ],
  hotel: [
    ["a reservation", "说明你有预订", "I have a reservation under my name."],
    ["breakfast included", "问早餐是否包含在房费里", "Is breakfast included in the room rate?"],
    ["late checkout", "询问延迟退房", "Is late checkout available?"],
  ],
  directions: [
    ["the nearest station", "问最近的车站在哪", "How do I get to the nearest station?"],
    ["on foot", "问走路要多久", "How long does it take on foot?"],
    ["turn right", "复述路线", "So I turn right at the next light, is that right?"],
  ],
  restaurant: [
    ["a table for two", "订两人桌", "I'd like to book a table for two."],
    ["recommend", "请服务员推荐菜品", "Which dish would you recommend?"],
    ["the bill", "请服务员结账", "Could we have the bill, please?"],
  ],
  shopping: [
    ["try it on", "询问能否试穿", "Can I try it on?"],
    ["a smaller size", "询问更小的尺码", "Do you have this in a smaller size?"],
    ["a refund", "询问退货退款", "Can I get a refund with this receipt?"],
  ],
  doctor: [
    ["a sore throat", "描述症状和持续时间", "I've had a sore throat for three days."],
    ["get worse", "说明什么时候更严重", "It gets worse at night."],
    ["a follow-up", "问是否需要复诊", "Do I need a follow-up appointment?"],
  ],
  interview: [
    ["I was responsible for", "交代你负责的工作", "I was responsible for coordinating a small team."],
    ["as a result", "补充具体结果", "As a result, we finished the project ahead of schedule."],
    ["success in this role", "问这个岗位如何衡量成功", "What does success look like in this role?"],
  ],
  standup: [
    ["yesterday", "汇报昨天的进展", "Yesterday, I finished the first draft."],
    ["blocked by", "点明阻塞项", "I'm blocked by a missing approval."],
    ["my next step", "说明下一步动作", "My next step is to review the draft with the team."],
  ],
  presentation: [
    ["the main finding", "先说主要发现", "The main finding was that response times improved."],
    ["one limitation", "承认一项局限", "One limitation is that the sample was small."],
    ["if I understand correctly", "先确认听众的问题", "If I understand correctly, you're asking how we measured that."],
  ],
  networking: [
    ["work on", "问对方最近在做什么", "What kind of projects do you work on?"],
    ["I'm interested in", "介绍自己的兴趣", "I'm interested in how small teams build products."],
    ["stay in touch", "邀请保持联系", "It was great meeting you. Let's stay in touch."],
  ],
  negotiation: [
    ["the delivery date", "确认交期", "Can we agree on the delivery date first?"],
    ["If we… could you…?", "用条件提出交换", "If we order more, could you offer a lower price?"],
    ["confirm the terms", "确认双方同意的条款", "Let me confirm the terms we agreed on."],
  ],
  videocall: [
    ["hear me clearly", "确认声音是否正常", "Can you hear me clearly?"],
    ["share my screen", "说明你要共享屏幕", "I'll share my screen to show you the draft."],
    ["action items", "结束时对齐行动项", "Before we go, let's review the action items."],
  ],
  oneonone: [
    ["I'd like feedback on", "说清想获得哪方面的反馈", "I'd like feedback on how I ran the meeting."],
    ["one thing I improved", "用具体例子说明进步", "One thing I improved was sharing updates earlier."],
    ["a goal for next month", "约定下个月的目标", "Can we set a goal for next month?"],
  ],
  pitch: [
    ["the problem", "先说客户遇到的问题", "The problem is that too much time goes into manual work."],
    ["our approach", "用一句话介绍方案", "Our approach is to automate the repetitive steps."],
    ["the next step", "给出具体下一步", "The next step could be a short demo with your team."],
  ],
  party: [
    ["How do you know…?", "用共同认识的人破冰", "How do you know the host?"],
    ["in your spare time", "问对方平时的兴趣", "What do you like doing in your spare time?"],
    ["nice talking to you", "礼貌地结束闲聊", "It was nice talking to you. Enjoy the party!"],
  ],
  friend: [
    ["How have you been?", "问朋友最近如何", "It's been a while. How have you been?"],
    ["I've been…", "说说最近在忙什么", "I've been getting used to my new job."],
    ["free this weekend", "约周末见面", "Are you free this weekend?"],
  ],
  phone: [
    ["I'm calling about", "说明打电话的原因", "I'm calling about a problem with my order."],
    ["the order number", "提供订单编号", "I have the order number if you need it."],
    ["resolve the issue", "问如何解决", "What can we do to resolve the issue?"],
  ],
};

export function practiceCues(scenarioId: string, custom?: CustomScene | null): readonly PracticeCue[] {
  if (scenarioId === "custom" && custom?.practice_cues?.length) {
    return custom.practice_cues.map(({ keyword, meaning, sentence }) => [keyword, meaning, sentence]);
  }
  return byScene[scenarioId] ?? general;
}
