// Stores one rendered set of stack plates: the browser draws them once,
// posts them here, and from then on everyone downloads them instead.
// Public endpoint (no JWT): it checks what it's given and never overwrites.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "plate-art";
const MAX_BYTES = 2 * 1024 * 1024;
const KEY = /^[a-z0-9]{7,40}\/[A-Za-z0-9 _-]{1,40}\/\d{1,6}-\d{1,2}$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isWebp = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(400, { error: "expected multipart form data" });
  }
  const key = String(form.get("key") ?? "");
  if (!KEY.test(key)) return reply(400, { error: "bad key" });
  const [engineRev, engine, rest] = key.split("/");
  const [seed, layers] = rest.split("-").map(Number);
  const width = Number(form.get("width")), height = Number(form.get("height"));
  if (!(width > 0 && width <= 4096 && height > 0 && height <= 4096)) return reply(400, { error: "bad size" });
  const files = form.getAll("plate").filter((f): f is File => f instanceof File);
  if (files.length < 1 || files.length > 64) return reply(400, { error: "1 to 64 plates" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: have } = await supabase.from("plate_art_sets").select("key").eq("key", key).maybeSingle();
  if (have) return reply(200, { key, cached: true });

  for (let i = 0; i < files.length; i++) {
    const bytes = new Uint8Array(await files[i].arrayBuffer());
    if (bytes.length > MAX_BYTES || !isWebp(bytes)) return reply(400, { error: `plate ${i} is not a WebP under 2 MB` });
    const { error } = await supabase.storage.from(BUCKET).upload(`${key}/${i}.webp`, bytes, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
    // already there from an earlier, interrupted upload: keep it
    if (error && !/exists|Duplicate/i.test(error.message)) return reply(500, { error: error.message });
  }
  const { error } = await supabase.from("plate_art_sets").insert({
    key, engine_rev: engineRev, engine, seed, layers, plates: files.length, width, height,
  });
  if (error && error.code !== "23505") return reply(500, { error: error.message });
  return reply(201, { key, cached: false });
});
