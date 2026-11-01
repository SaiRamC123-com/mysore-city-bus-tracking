import { Router } from "express";
import { z } from "zod";
import { chat } from "../chat/chatService.js";
import { ah, HttpError } from "../utils/http.js";

const r = Router();

const body = z.object({
  message: z.string().min(1).max(500),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(20).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
});

r.post("/chat", ah(async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid chat request.");
  try {
    res.json(await chat(parsed.data));
  } catch (e) {
    if (e.status === 503) throw e;
    console.error("[chat]", e.status ?? "", e.message);
    // While developing (NODE_ENV is not "production") show the real reason in the chat window too.
    const why = process.env.NODE_ENV === "production" ? "" : ` [${e.status ?? "no status"}] ${String(e.message).slice(0, 300)}`;
    if (e.status === 401) throw new HttpError(502, "The chat AI rejected the server's API key." + why);
    if (e.status === 429) throw new HttpError(429, "The chat AI is busy right now. Please try again in a few seconds.");
    throw new HttpError(502, "The chat AI is unavailable right now." + why);
  }
}));

export default r;