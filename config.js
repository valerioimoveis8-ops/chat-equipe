// Configuração do Chat da Equipe.
// Deixe supabaseUrl vazio para abrir em MODO DEMONSTRAÇÃO (dados de exemplo, nada é salvo).
// Depois de criar o projeto no Supabase, cole aqui a URL e a chave "anon public"
// (Supabase → Project Settings → API). A chave anon pode ficar pública: quem protege
// os dados são as regras de segurança do arquivo supabase/schema.sql.
window.CHAT_CONFIG = {
  supabaseUrl: 'https://ropzoigwcpvjgiikujca.supabase.co',
  // Cole entre as aspas a chave "anon public" (Supabase → Project Settings → API Keys → Legacy).
  supabaseAnonKey: '',
  // true = quando alguém escreve "@Nome" de uma IA com resposta automática ligada,
  // o chat chama a IA pela API da Anthropic (função "responder-ia" no Supabase).
  iaAutomatica: true,
  nomeDoChat: 'Chat da Equipe',
};
