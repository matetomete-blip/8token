require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { enabled: false } });
(async () => {
  const { data: user } = await supabase.from("users").select("id, email, plan, plan_expires_at").eq("email", "teste@teste.com").single();
  console.log("USER:", JSON.stringify(user));
  if (user) {
    const { data: subs } = await supabase.from("ip_subscriptions").select("id, ip, plan, status, user_id, expires_at").eq("user_id", user.id);
    console.log("SUBS_BY_USER:", JSON.stringify(subs, null, 2));
  }
  const { data: subsByIp } = await supabase.from("ip_subscriptions").select("id, ip, plan, status, user_id, expires_at").eq("ip", "179.160.108.181");
  console.log("SUBS_BY_IP:", JSON.stringify(subsByIp, null, 2));
})();