// Função "responder-ia" (Supabase Edge Function)
// O chat chama esta função quando alguém escreve "@Nome" de uma IA com resposta
// automática, ou usa o botão "Pedir resposta de uma IA".
// Ela lê as últimas mensagens da sala (com imagens e PDFs recentes), pede a resposta
// à API da Anthropic como aquela IA e grava a resposta no chat.
//
// Segredos (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   obrigatório
//   ANTHROPIC_MODEL     opcional (padrão: claude-sonnet-4-5)
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY o Supabase já fornece.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const HISTORICO = 40; // mensagens que a IA lê
const ANEXOS_RECENTES = 8; // das últimas N mensagens, manda imagens e PDFs junto

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp(405, { erro: 'Use POST.' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const chave = Deno.env.get('ANTHROPIC_API_KEY');
    const modelo = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
    if (!chave) return resp(503, { erro: 'A resposta automática não está ligada (falta ANTHROPIC_API_KEY).' });

    // Quem pediu precisa ser membro do chat.
    const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: quemPediu } = await comoUsuario.rpc('meu_membro_id');
    if (!quemPediu) return resp(401, { erro: 'Só membros do chat podem pedir resposta.' });

    const { sala_id, membro_id } = await req.json().catch(() => ({}));
    if (!sala_id || !membro_id) return resp(400, { erro: 'Faltou a sala ou a IA.' });

    const admin = createClient(url, service);
    const { data: ia } = await admin.from('membros').select('*').eq('id', membro_id).eq('tipo', 'ia').maybeSingle();
    if (!ia) return resp(404, { erro: 'IA não encontrada.' });
    if (!ia.auto) return resp(400, { erro: `${ia.nome} está marcada para responder só pelo Chrome.` });
    const { data: sala } = await admin.from('salas').select('nome').eq('id', sala_id).maybeSingle();
    if (!sala) return resp(404, { erro: 'Sala não encontrada.' });

    const { data: membros } = await admin.from('membros').select('id,nome,tipo');
    const nomeDe = (id: string) => membros?.find((m) => m.id === id)?.nome ?? 'Alguém';
    const { data: ultimas } = await admin.from('mensagens').select('*').eq('sala_id', sala_id)
      .order('criada_em', { ascending: false }).limit(HISTORICO);
    const lista = (ultimas ?? []).reverse();

    // Conversa em texto, com hora e autor.
    const linhas = lista.map((m) => {
      const h = new Date(m.criada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const anexo = m.anexo_nome ? ` [anexo: ${m.anexo_nome}]` : '';
      return `[${h}] ${nomeDe(m.membro_id)}: ${m.texto ?? ''}${anexo}`;
    });

    // Imagens e PDFs das últimas mensagens vão junto, por link temporário.
    const blocos: unknown[] = [];
    for (const m of lista.slice(-ANEXOS_RECENTES)) {
      if (!m.anexo_path) continue;
      const tipo = String(m.anexo_tipo ?? '');
      const ehImg = /^image\/(png|jpe?g|gif|webp)$/.test(tipo);
      const ehPdf = tipo === 'application/pdf';
      if (!ehImg && !ehPdf) continue;
      const { data: link } = await admin.storage.from('anexos').createSignedUrl(m.anexo_path, 600);
      if (!link?.signedUrl) continue;
      blocos.push({ type: 'text', text: `Anexo "${m.anexo_nome}" enviado por ${nomeDe(m.membro_id)}:` });
      blocos.push(ehImg
        ? { type: 'image', source: { type: 'url', url: link.signedUrl } }
        : { type: 'document', source: { type: 'url', url: link.signedUrl } });
    }

    const outros = (membros ?? []).filter((m) => m.id !== ia.id).map((m) => `${m.nome} (${m.tipo === 'ia' ? 'IA' : 'pessoa'})`).join(', ');
    const system = [
      ia.instrucoes || `Você é ${ia.nome}, uma IA da equipe.`,
      `Você está na sala "#${sala.nome}" do chat da equipe, junto com: ${outros}.`,
      `Escreva só a sua próxima mensagem, como ${ia.nome}, em português do Brasil, curta e direta, sem repetir o seu nome no começo.`,
      'Para chamar alguém, use @Nome. Não invente números, endereços nem preços: se não souber, diga o que falta.',
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 1200,
        system,
        messages: [{
          role: 'user',
          content: [
            ...blocos,
            { type: 'text', text: `Conversa até agora:\n\n${linhas.join('\n')}\n\nAgora responda como ${ia.nome}.` },
          ],
        }],
      }),
    });
    if (!r.ok) {
      console.error('anthropic', r.status, await r.text());
      return resp(502, { erro: 'A IA não respondeu agora. Tente de novo em alguns minutos.' });
    }
    const dados = await r.json();
    let texto = (dados.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim();
    texto = texto.replace(new RegExp(`^\\s*${ia.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    if (!texto) return resp(502, { erro: 'A IA respondeu vazio.' });

    const { error } = await admin.from('mensagens').insert({ sala_id, membro_id: ia.id, texto: texto.slice(0, 8000), via: 'api' });
    if (error) throw error;
    return resp(200, { ok: true });
  } catch (e) {
    console.error(e);
    return resp(500, { erro: 'Erro inesperado na resposta automática.' });
  }
});
