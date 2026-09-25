require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { enabled: false } });

(async () => {
  console.log("Iniciando limpeza e merge de usuários...");

  // 1. Merge matetomete@gmaill.com (typo) -> matetomete@gmail.com
  const wrongEmail = "matetomete@gmaill.com";
  const correctEmail = "matetomete@gmail.com";
  const { data: wrongUser } = await supabase.from("users").select("*").eq("email", wrongEmail).single();
  const { data: correctUser } = await supabase.from("users").select("*").eq("email", correctEmail).single();

  if (wrongUser && correctUser) {
    console.log("Merge: " + wrongUser.id + " (" + wrongEmail + ") -> " + correctUser.id + " (" + correctEmail + ")");
    await supabase.from("ip_subscriptions").update({ user_id: correctUser.id }).eq("user_id", wrongUser.id);
    await supabase.from("api_keys").update({ user_id: correctUser.id }).eq("user_id", wrongUser.id);
    const { error: delErr } = await supabase.from("users").delete().eq("id", wrongUser.id);
    if (delErr) console.error("Erro ao deletar usuário errado:", delErr.message);
    else console.log("Usuário com typo deletado com sucesso.");
  } else {
    console.log("Usuários para merge não encontrados ou já corrigidos.");
  }

  // 2. Limpar usuários de teste e SQL injection
  const testEmails = [
    "testuser@8token.tech",
    "authtest@8token.tech",
    "' OR '1'='1'--",
    "' OR '1'='1",
    "' OR '1'='1'/*"
  ];

  for (const email of testEmails) {
    const { data: user } = await supabase.from("users").select("id").eq("email", email).single();
    if (user) {
      await supabase.from("ip_subscriptions").delete().eq("user_id", user.id);
      await supabase.from("api_keys").delete().eq("user_id", user.id);
      await supabase.from("users").delete().eq("id", user.id);
      console.log("Deletado usuário de teste: " + email);
    }
  }

  // 3. Verificar estado final
  const { data: finalUsers } = await supabase.from("users").select("id, email, name, google_id").order("created_at");
  console.log("\nUsuários restantes no sistema:");
  console.table(finalUsers);

  process.exit(0);
})();