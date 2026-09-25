require("dotenv").config();
const http = require("http");
const { createClient } = require("@supabase/supabase-js");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { enabled: false } });
const ADMIN_SECRET = process.env.ADMIN_SECRET || "3f9a6f8855c93b592bea5e793b60315a816c88a678ccb713a7827bbf9f026836";
const SUB_ID = "0918574e-ae19-41b6-9fb9-4fb972696390";

function putPlan(plan) {
  const body = JSON.stringify({ plan });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port: 3000,
      path: "/api/admin/subscriptions/" + SUB_ID,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + ADMIN_SECRET,
        "Content-Length": Buffer.byteLength(body)
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  // Step 1: Change to trimestral
  console.log("--- Changing to trimestral ---");
  const r1 = await putPlan("trimestral");
  console.log("PUT result:", JSON.stringify(r1));
  await new Promise(r => setTimeout(r, 1500));
  const { data: u1 } = await supabase.from("users").select("id, email, plan").eq("email", "teste@teste.com").single();
  console.log("USER after PUT trimestral:", JSON.stringify(u1));

  // Step 2: Change back to mensal
  console.log("--- Changing back to mensal ---");
  const r2 = await putPlan("mensal");
  console.log("PUT result:", JSON.stringify(r2));
  await new Promise(r => setTimeout(r, 1500));
  const { data: u2 } = await supabase.from("users").select("id, email, plan").eq("email", "teste@teste.com").single();
  console.log("USER after PUT mensal:", JSON.stringify(u2));

  console.log("--- DONE ---");
})();