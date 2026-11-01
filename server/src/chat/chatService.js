import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { getStatic } from "../services/dataService.js";
import { tools, runTool } from "./tools.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

let shared;
function defaultClient() {
  if (!env.groqKey) {
    const e = new Error("The chatbot is not configured: GROQ_API_KEY is missing on the server.");
    e.status = 503;
    throw e;
  }
  return (shared ??= new Groq({ apiKey: env.groqKey }));
}

const isToolFormatError = (e) => e?.status === 400 && /tool_use_failed|failed_generation/i.test(JSON.stringify(e?.error ?? e?.message ?? ""));

/**
 * Tool-calling loop: the model decides which bus-data tool to call, we run it against our own
 * data, feed the result back, and the model answers using only that data.
 * `client` is injectable so the loop can be tested without a network or an API key.
 */
export async function chat({ message, history = [], location = null }, { client } = {}) {
  const groq = client ?? defaultClient();
  const { routeList } = await getStatic();
  const network = routeList.map((r) => `Route ${r.number} (${r.name}): ${r.stops.map((s) => s.name).join(" -> ")}`).join("\n");
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT.replace("{{NETWORK}}", network).replace("{{NOW}}", now).replace("{{LOCATION}}", JSON.stringify(location)),
    },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const toolsUsed = [];
  let retried = false;

  for (let step = 0; step < 6; step++) {
    let res;
    try {
      res = await groq.chat.completions.create({
        model: env.groqModel,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 700,
      });
    } catch (e) {
      // Llama models on Groq occasionally emit a malformed tool call; one retry usually fixes it.
      if (isToolFormatError(e) && !retried) {
        retried = true;
        continue;
      }
      throw e;
    }

    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) return { reply: msg.content ?? "", toolsUsed };

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let result;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        toolsUsed.push(call.function.name);
        result = await runTool(call.function.name, args);
      } catch (e) {
        result = { error: `Tool failed: ${e.message}` };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "Sorry, I couldn't get that information right now. Please try again in a moment.", toolsUsed };
}
