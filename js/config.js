// Configuração do backend Supabase (camada gratuita).
//
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os valores do seu projeto
// (Supabase Dashboard > Project Settings > API). A anon key é pública por
// natureza — quem protege os dados é a Row Level Security (ver
// supabase/schema.sql), não o sigilo desta chave.
//
// Enquanto não configurado, o app funciona 100% offline (cadastro e
// operação local funcionam), só a sincronização fica desativada.
window.PRATO_CHEIO_CONFIG = {
  SUPABASE_URL: "https://urgtbnjljbbssmvmquen.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZ3RibmpsamJic3Ntdm1xdWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzk1ODIsImV4cCI6MjEwNDY1NTU4Mn0.T_3XW9H038gdETuoHGV_wEg-bVg-ITRHhY4dO3XkXY4",
};
