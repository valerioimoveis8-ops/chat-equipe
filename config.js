// Configuração do Chat da Equipe.
// Deixe supabaseUrl vazio para abrir em MODO DEMONSTRAÇÃO (dados de exemplo, nada é salvo).
// Depois de criar o projeto no Supabase, cole aqui a URL e a chave "anon public"
// (Supabase → Project Settings → API). A chave anon pode ficar pública: quem protege
// os dados são as regras de segurança do arquivo supabase/schema.sql.
window.CHAT_CONFIG = {
  supabaseUrl: 'https://ropzoigwcpvjgiikujca.supabase.co',
  // Cole entre as aspas a chave "anon public" (Supabase → Project Settings → API Keys → Legacy).
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvcHpvaWd3Y3B2amdpaWt1amNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMDcxNDgsImV4cCI6MjEwODg4MzE0OH0.I2_DpItVHbyc_wk-VgE0lfi-7gf1mamKhCnuD2PVQgA',
  // true = quando alguém escreve "@Nome" de uma IA com resposta automática ligada,
  // o chat chama a IA pela API da Anthropic (função "responder-ia" no Supabase).
  iaAutomatica: true,
  nomeDoChat: 'Chat da Equipe',
};
