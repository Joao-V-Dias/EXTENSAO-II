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
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
