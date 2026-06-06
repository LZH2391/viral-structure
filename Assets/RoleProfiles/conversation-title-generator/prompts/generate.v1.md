请根据用户第一条消息的首句生成一个中文会话标题。

输入摘要：
{{inputSummaryJson}}

用户第一条消息首句：
{{firstSentence}}

输出要求：
- 只返回 JSON object。
- title 为 4 到 18 个中文字符或等价长度的短标题。
- 不要使用 Markdown、引号包裹标题、句号、换行或解释。
- 不要生成业务 brief；只命名这次对话。
- 如果首句过短或信息不足，用朴素标题概括用户动作，例如“重组方案讨论”“会话标题设置”。

返回格式：
{
  "schemaVersion": "agent_chat_title.v1",
  "title": "短标题",
  "confidence": 0.0
}
