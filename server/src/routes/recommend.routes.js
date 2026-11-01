import { Router } from "express";
import { recommend } from "../services/recommendService.js";
import { ah, HttpError } from "../utils/http.js";

const r = Router();

// GET /api/recommend?from=Zoo&to=Chamundi Hills   (stop names or ids)
r.get("/recommend", ah(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new HttpError(400, "Both 'from' and 'to' are required.");
  const out = await recommend(String(from), String(to));
  if (out.error) return res.status(404).json(out);
  res.json(out);
}));

export default r;
