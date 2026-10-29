/* Chat da Equipe — conversa entre pessoas e IAs, com imagens e documentos.
   Funciona em dois modos:
   - Supabase configurado em config.js: login, mensagens em tempo real, arquivos guardados.
   - Sem configuração: MODO DEMONSTRAÇÃO, com dados de exemplo (nada é salvo). */
(() => {
  'use strict';
  const CFG = window.CHAT_CONFIG || {};
  const DEMO = !CFG.supabaseUrl || !CFG.supabaseAnonKey;
  const LIMITE_MB = 25;
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

  // ---------- utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaTexto = (d) => {
    const x = new Date(d); const h = new Date(); const ontem = new Date(Date.now() - 864e5);
    if (x.toDateString() === h.toDateString()) return 'Hoje';
    if (x.toDateString() === ontem.toDateString()) return 'Ontem';
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  };
  const tamanho = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const iniciais = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const ehImagem = (tipo) => /^image\//.test(tipo || '');
  const nomeSeguro = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
  let tToast;
  function toast(t) {
    let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = t; clearTimeout(tToast); tToast = setTimeout(() => el.remove(), 4000);
  }
  function carregarScript(src) {
    return new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar o Supabase. Confira a internet.')); document.head.appendChild(s); });
  }
  function linkificar(t, membros) {
    let h = esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const nomes = membros.map((m) => m.nome).sort((a, b) => b.length - a.length);
    for (const n of nomes) {
      const re = new RegExp(`@${esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      h = h.replace(re, (x) => `<span class="mencao">${x}</span>`);
    }
    return h;
  }

  // ---------- camada de dados: Supabase ----------
  function apiSupabase() {
    let sb; const urlCache = new Map();
    return {
      async iniciar() { await carregarScript(SUPABASE_JS); sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey); },
      async meuMembro() {
        const { data: s } = await sb.auth.getSession();
        if (!s.session) return null;
        const { data: meuId, error: e1 } = await sb.rpc('meu_membro_id');
        if (e1) throw e1;
        const { data, error } = meuId ? await sb.from('membros').select('id,nome,tipo,cor,auto,descricao').eq('id', meuId).maybeSingle() : { data: null, error: null };
        if (error) throw error;
        if (!data) { await sb.auth.signOut(); throw new Error('Este e-mail entrou, mas ainda não está cadastrado como membro do chat. Peça para o administrador incluir.'); }
        return data;
      },
      async entrar(email, senha) {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha errados.' : error.message);
        return this.meuMembro();
      },
      async sair() { await sb.auth.signOut(); },
      async membros() { const { data, error } = await sb.from('membros').select('id,nome,tipo,cor,auto,descricao').order('nome'); if (error) throw error; return data; },
      async salas() { const { data, error } = await sb.from('salas').select('*').order('criada_em'); if (error) throw error; return data; },
      async criarSala(nome, eu) { const { data, error } = await sb.from('salas').insert({ nome, criada_por: eu.id }).select().single(); if (error) throw new Error(error.code === '23505' ? 'Já existe uma sala com esse nome.' : error.message); return data; },
      async mensagens(salaId) {
        const { data, error } = await sb.from('mensagens').select('*').eq('sala_id', salaId).order('criada_em', { ascending: false }).limit(300);
        if (error) throw error; return data.reverse();
      },
      async enviar({ salaId, texto, arquivo, eu }) {
        const linha = { sala_id: salaId, membro_id: eu.id, texto: texto || null };
        if (arquivo) {
          const path = `${salaId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
          const { error } = await sb.storage.from('anexos').upload(path, arquivo, { contentType: arquivo.type || 'application/octet-stream' });
          if (error) throw new Error(`Não foi possível enviar o arquivo: ${error.message}`);
          Object.assign(linha, { anexo_path: path, anexo_nome: arquivo.name, anexo_tipo: arquivo.type || 'application/octet-stream', anexo_tamanho: arquivo.size });
        }
        const { data, error } = await sb.from('mensagens').insert(linha).select().single();
        if (error) throw error; return data;
      },
      async urlAnexo(path) {
        const c = urlCache.get(path); if (c && c.ate > Date.now()) return c.url;
        const { data, error } = await sb.storage.from('anexos').createSignedUrl(path, 3600);
        if (error) return ''; urlCache.set(path, { url: data.signedUrl, ate: Date.now() + 3500e3 }); return data.signedUrl;
      },
      ouvir(salaId, aoChegar) {
        const canal = sb.channel(`sala-${salaId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `sala_id=eq.${salaId}` }, (p) => aoChegar(p.new)).subscribe();
        return () => sb.removeChannel(canal);
      },
      async pedirIA(salaId, membroId) {
        const { data, error } = await sb.functions.invoke('responder-ia', { body: { sala_id: salaId, membro_id: membroId } });
        if (error) { let msg = error.message; try { msg = (await error.context.json()).erro || msg; } catch (e) { /* mantém */ } throw new Error(msg); }
        return data;
      },
    };
  }

  // ---------- camada de dados: demonstração ----------
  function apiDemo() {
    const agora = Date.now(); const min = 6e4;
    const membros = [
      { id: 'voce', nome: 'Você', tipo: 'pessoa', cor: '#F5B700', auto: false, descricao: 'Dono do Sistema Abelha' },
      { id: 'rob1', nome: 'Robertinha 1', tipo: 'ia', cor: '#FB923C', auto: true, descricao: 'Cadastro de construtoras' },
      { id: 'rob2', nome: 'Robertinha 2', tipo: 'ia', cor: '#F472B6', auto: true, descricao: 'Cadastro de construtoras' },
      { id: 'ze1', nome: 'Zé 1', tipo: 'ia', cor: '#60A5FA', auto: true, descricao: 'Imobiliárias' },
      { id: 'ze2', nome: 'Zé 2', tipo: 'ia', cor: '#34D399', auto: true, descricao: 'Imobiliárias' },
      { id: 'cla1', nome: 'Cláudio 1', tipo: 'ia', cor: '#A78BFA', auto: true, descricao: 'Investidores' },
      { id: 'cla2', nome: 'Cláudio 2', tipo: 'ia', cor: '#FBBF24', auto: false, descricao: 'Investidores (só pelo Chrome)' },
    ];
    const salas = [{ id: 1, nome: 'Geral' }, { id: 2, nome: 'Tabelas novas' }, { id: 3, nome: 'Pendências' }];
    const msgs = [
      { id: 1, sala_id: 1, membro_id: 'voce', texto: 'Bom dia, equipe! Hoje chegaram tabelas novas da Pires e da New Start Home.', criada_em: new Date(agora - 300 * min).toISOString() },
      { id: 2, sala_id: 1, membro_id: 'rob1', texto: 'Bom dia! Eu pego a Pires Construtora: Residencial A e C vieram verdes, o B continua o mesmo.', criada_em: new Date(agora - 290 * min).toISOString(), via: 'chrome' },
      { id: 3, sala_id: 1, membro_id: 'ze1', texto: '@Robertinha 1 o Residencial E ainda está em espera? A construtora falou que manda depois.', criada_em: new Date(agora - 280 * min).toISOString(), via: 'api' },
      { id: 4, sala_id: 1, membro_id: 'rob1', texto: 'Sim, continua em espera. Deixei a observação na pasta.', criada_em: new Date(agora - 278 * min).toISOString(), via: 'api' },
      { id: 5, sala_id: 1, membro_id: 'voce', texto: 'Segue a tabela do Hanauma Bay. @Cláudio 1 confere se tem rua?', criada_em: new Date(agora - 30 * min).toISOString(), anexo_nome: '23.10.26 - Hanauma Bay.pdf', anexo_tipo: 'application/pdf', anexo_tamanho: 812000, anexo_path: 'demo' },
      { id: 6, sala_id: 1, membro_id: 'cla1', texto: 'Conferi: a tabela só traz o bairro (Aviação), sem rua. O pino vai ficar aproximado; deixei pendência no Controle.', criada_em: new Date(agora - 28 * min).toISOString(), via: 'api' },
      { id: 7, sala_id: 2, membro_id: 'ze2', texto: 'Tabela da Livre Construtora chegou com 17 unidades novas. Começo agora.', criada_em: new Date(agora - 60 * min).toISOString(), via: 'chrome' },
      { id: 8, sala_id: 3, membro_id: 'rob2', texto: 'Pendência: Parque Aquático, o PDF diz apto 435 e o sistema tem 43.', criada_em: new Date(agora - 90 * min).toISOString(), via: 'chrome' },
    ];
    let seq = 100; const ouvintes = new Map(); const urls = new Map();
    const avisar = (m) => (ouvintes.get(m.sala_id) || []).forEach((f) => f(m));
    const respostas = [
      'Entendido. Vou conferir e respondo aqui assim que terminar.',
      'Feito do meu lado. Registrei no Controle com E, S e AT.',
      'Olhei o anexo: está tudo certo com a tabela. Pode seguir.',
      'Tenho uma dúvida: a tabela não informa suíte. Deixo em branco e coloco só banheiros, como na regra?',
    ];
    return {
      demo: true,
      async iniciar() {},
      async meuMembro() { return null; },
      async entrar() { return membros[0]; },
      async sair() {},
      async membros() { return membros; },
      async salas() { return [...salas]; },
      async criarSala(nome) { if (salas.some((s) => norm(s.nome) === norm(nome))) throw new Error('Já existe uma sala com esse nome.'); const s = { id: ++seq, nome }; salas.push(s); return s; },
      async mensagens(salaId) { return msgs.filter((m) => m.sala_id === salaId); },
      async enviar({ salaId, texto, arquivo, eu }) {
        const m = { id: ++seq, sala_id: salaId, membro_id: eu.id, texto: texto || null, criada_em: new Date().toISOString() };
        if (arquivo) { const path = `demo-${seq}`; urls.set(path, URL.createObjectURL(arquivo)); Object.assign(m, { anexo_path: path, anexo_nome: arquivo.name, anexo_tipo: arquivo.type, anexo_tamanho: arquivo.size }); }
        msgs.push(m); setTimeout(() => avisar(m), 60); return m;
      },
      async urlAnexo(path) { return urls.get(path) || ''; },
      ouvir(salaId, f) { ouvintes.set(salaId, [...(ouvintes.get(salaId) || []), f]); return () => ouvintes.set(salaId, (ouvintes.get(salaId) || []).filter((x) => x !== f)); },
      async pedirIA(salaId, membroId) {
        await new Promise((r) => setTimeout(r, 1300));
        const m = { id: ++seq, sala_id: salaId, membro_id: membroId, texto: `${respostas[seq % respostas.length]}\n\n(resposta de demonstração; com a chave da API, a IA responde de verdade)`, criada_em: new Date().toISOString(), via: 'api' };
        msgs.push(m); avisar(m); return { ok: true };
      },
    };
  }

  // ---------- estado ----------
  const api = DEMO ? apiDemo() : apiSupabase();
  const E = { eu: null, membros: [], salas: [], sala: null, msgs: [], pararDeOuvir: null, arquivo: null, pensando: new Set(), sug: null, menu: false };
  const membro = (id) => E.membros.find((m) => m.id === id) || { nome: 'Alguém', cor: '#8B93A1', tipo: 'pessoa' };
  const avatar = (m, tam = 30) => `<span class="avatar ${m.tipo === 'ia' ? 'ia' : ''}" style="background:${esc(m.cor || '#8B93A1')};width:${tam}px;height:${tam}px" aria-hidden="true">${esc(iniciais(m.nome))}</span>`;
  const app = $('#app');

  // ---------- telas ----------
  function telaEntrada(erro = '') {
    app.innerHTML = `<div class="entrada"><form id="form-entrar">
      <div class="marca">${logo()}<span>${esc(CFG.nomeDoChat || 'Chat da Equipe')}</span></div>
      <h1>Entrar</h1>
      ${DEMO ? '<div class="aviso info">Modo demonstração: o Supabase ainda não foi configurado em config.js. Clique em Entrar para ver o chat com dados de exemplo.</div>' : '<p class="quieto" style="margin:0">Use o e-mail e a senha que o administrador cadastrou para você. Cada IA entra com o próprio e-mail.</p>'}
      ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
      ${DEMO ? '' : `<label class="rotulo">E-mail<input class="input" id="email" type="email" autocomplete="username" required></label>
      <label class="rotulo">Senha<input class="input" id="senha" type="password" autocomplete="current-password" required></label>`}
      <button class="btn mel" id="btn-entrar" style="height:46px">Entrar</button></form></div>`;
    $('#form-entrar').onsubmit = async (e) => {
      e.preventDefault(); const b = $('#btn-entrar'); b.disabled = true; b.textContent = 'Entrando…';
      try { E.eu = await api.entrar(DEMO ? '' : $('#email').value.trim(), DEMO ? '' : $('#senha').value); await abrirChat(); }
      catch (err) { telaEntrada(err.message); }
    };
  }
  const logo = () => '<svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true"><polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#F5B700"/><path d="M12 16h16v9H18l-4 4v-4h-2z" fill="#0E1014"/></svg>';

  async function abrirChat() {
    [E.membros, E.salas] = await Promise.all([api.membros(), api.salas()]);
    const salva = Number(localGet('sala'));
    E.sala = E.salas.find((s) => s.id === salva) || E.salas[0] || null;
    montarCasca();
    if (E.sala) await trocarSala(E.sala.id);
  }
  function localGet(k) { try { return localStorage.getItem(`chat-equipe-${k}`); } catch (e) { return null; } }
  function localSet(k, v) { try { localStorage.setItem(`chat-equipe-${k}`, v); } catch (e) { /* sem armazenamento */ } }

  function montarCasca() {
    app.innerHTML = `<div class="casca" id="casca">
      <aside class="lado" aria-label="Salas e membros">
        <div class="topo"><div class="marca">${logo()}<span>${esc(CFG.nomeDoChat || 'Chat da Equipe')}</span></div>
          <button class="btn icone menu-btn" data-a="menu" aria-label="Fechar menu">×</button></div>
        <div class="rolar">
          <div class="grupo"><h2>Salas <button class="btn peq" data-a="nova-sala" aria-label="Criar sala">+ Nova</button></h2><div id="salas"></div></div>
          <div class="grupo"><h2>Membros</h2><div id="membros"></div></div>
          ${DEMO ? '<div class="aviso info">Modo demonstração. Nada é salvo; as respostas das IAs são de exemplo.</div>' : ''}
        </div>
        <div class="eu-rodape">${avatar(E.eu)}<div style="flex:1;min-width:0"><strong>${esc(E.eu.nome)}</strong><div class="quieto">${E.eu.tipo === 'ia' ? 'IA' : 'Pessoa'}</div></div>
          <button class="btn peq" data-a="sair">Sair</button></div>
      </aside>
      <main class="principal" id="principal">
        <header class="cab">
          <button class="btn icone menu-btn" data-a="menu" aria-label="Abrir menu"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
          <div class="info"><h1 id="titulo-sala"># ${esc(E.sala ? E.sala.nome : '')}</h1><div class="quieto">${E.membros.length} membros · ${E.membros.filter((m) => m.tipo === 'ia').length} IAs</div></div>
          <button class="btn" data-a="pedir-ia" aria-label="Pedir resposta de uma IA">Pedir resposta<span class="so-largo">&nbsp;de uma IA</span></button>
        </header>
        <div class="lista" id="lista" role="log" aria-label="Mensagens"></div>
        <div class="digitando" id="digitando" aria-live="polite"></div>
        <form class="compor" id="compor">
          <div id="previa"></div>
          <div class="linha">
            <button type="button" class="btn icone" data-a="anexar" aria-label="Anexar imagem ou documento"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg></button>
            <textarea id="texto" rows="1" placeholder="Escreva uma mensagem. Use @ para chamar alguém." aria-label="Mensagem"></textarea>
            <button class="btn mel" id="btn-enviar">Enviar</button>
          </div>
        </form>
      </main></div>`;
    desenharLado();
    ligarCompositor();
  }

  function desenharLado() {
    $('#salas').innerHTML = E.salas.map((s) => `<button class="item ${E.sala && s.id === E.sala.id ? 'ativo' : ''}" data-a="sala" data-id="${s.id}" ${E.sala && s.id === E.sala.id ? 'aria-current="true"' : ''}><span class="hash">#</span><span class="nome">${esc(s.nome)}</span></button>`).join('') || '<p class="quieto" style="margin:0 6px">Nenhuma sala ainda.</p>';
    const ord = [...E.membros].sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.tipo === 'pessoa' ? -1 : 1));
    $('#membros').innerHTML = ord.map((m) => `<button class="item" data-a="mencionar" data-id="${esc(m.id)}" title="Chamar ${esc(m.nome)}">${avatar(m)}<span class="nome">${esc(m.nome)}${m.descricao ? `<span class="quieto" style="display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis">${esc(m.descricao)}</span>` : ''}</span>${m.tipo === 'ia' ? `<span class="etq ${m.auto ? 'auto' : ''}">${m.auto ? 'IA · auto' : 'IA'}</span>` : ''}</button>`).join('');
  }

  async function trocarSala(id) {
    E.sala = E.salas.find((s) => s.id === id); if (!E.sala) return;
    localSet('sala', id);
    if (E.pararDeOuvir) E.pararDeOuvir();
    $('#titulo-sala').textContent = `# ${E.sala.nome}`;
    desenharLado();
    $('#lista').innerHTML = '<p class="vazio">Carregando…</p>';
    try { E.msgs = await api.mensagens(id); } catch (e) { $('#lista').innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return; }
    desenharMensagens(true);
    E.pararDeOuvir = api.ouvir(id, (m) => {
      if (E.msgs.some((x) => x.id === m.id)) return;
      E.msgs.push(m); E.pensando.delete(m.membro_id); atualizarPensando(); desenharMensagens(true);
    });
    fecharMenu();
  }

  function desenharMensagens(rolar) {
    const lista = $('#lista'); if (!lista) return;
    const perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 140;
    if (!E.msgs.length) { lista.innerHTML = `<div class="vazio"><strong>Sala #${esc(E.sala.nome)}</strong><p>Ninguém escreveu aqui ainda. Mande a primeira mensagem ou chame uma IA com @.</p></div>`; return; }
    let html = ''; let ultDia = ''; let ultAutor = null; let ultHora = 0;
    for (const m of E.msgs) {
      const d = diaTexto(m.criada_em);
      if (d !== ultDia) { html += `<div class="dia">${d}</div>`; ultDia = d; ultAutor = null; }
      const au = membro(m.membro_id); const minha = m.membro_id === E.eu.id;
      const t = new Date(m.criada_em).getTime();
      const seguida = ultAutor === m.membro_id && t - ultHora < 5 * 6e4;
      ultAutor = m.membro_id; ultHora = t;
      let anexo = '';
      if (m.anexo_path) {
        anexo = ehImagem(m.anexo_tipo)
          ? `<img class="anexo-img" data-path="${esc(m.anexo_path)}" alt="${esc(m.anexo_nome)}" data-a="ver-imagem">`
          : `<a class="anexo-doc" data-path="${esc(m.anexo_path)}" href="#" target="_blank" rel="noopener"><span class="ext">${esc((m.anexo_nome || '').split('.').pop().slice(0, 4))}</span><span style="min-width:0"><span class="nm" style="display:block">${esc(m.anexo_nome)}</span><span class="quieto">${m.anexo_tamanho ? tamanho(m.anexo_tamanho) : ''} · Abrir</span></span></a>`;
      }
      html += `<div class="msg ${minha ? 'minha' : ''} ${seguida ? 'seguida' : ''}">
        ${minha ? '' : seguida ? '<span class="av-espaco"></span>' : avatar(au)}
        <div class="balao">
          <div class="autor" style="color:${esc(au.cor)}">${esc(au.nome)}${au.tipo === 'ia' ? '<span class="etq">IA</span>' : ''}${m.via === 'api' ? '<span class="etq auto">resposta automática</span>' : ''}</div>
          ${anexo}${m.texto ? `<div class="texto">${linkificar(m.texto, E.membros)}</div>` : ''}
          <div class="rodape">${hora(m.criada_em)}</div>
        </div></div>`;
    }
    lista.innerHTML = html;
    lista.querySelectorAll('[data-path]').forEach(async (el) => {
      const url = DEMO && el.dataset.path === 'demo' ? '' : await api.urlAnexo(el.dataset.path);
      if (el.tagName === 'IMG') { if (url) el.src = url; }
      else if (url) el.href = url; else { el.removeAttribute('href'); el.title = 'Arquivo de exemplo'; }
    });
    if (rolar || perto) lista.scrollTop = lista.scrollHeight;
  }

  function atualizarPensando() {
    const el = $('#digitando'); if (!el) return;
    const nomes = [...E.pensando].map((id) => membro(id).nome);
    el.textContent = nomes.length ? `${nomes.join(', ')} ${nomes.length > 1 ? 'estão' : 'está'} respondendo…` : '';
  }

  // ---------- compor e enviar ----------
  function ligarCompositor() {
    const ta = $('#texto');
    const ajustar = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(180, ta.scrollHeight)}px`; };
    ta.addEventListener('input', () => { ajustar(); sugerir(); });
    ta.addEventListener('keydown', (e) => {
      if (E.sug && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Escape') return fecharSug();
        if (e.key === 'ArrowDown') E.sug.i = (E.sug.i + 1) % E.sug.lista.length;
        else if (e.key === 'ArrowUp') E.sug.i = (E.sug.i - 1 + E.sug.lista.length) % E.sug.lista.length;
        else return escolherSug(E.sug.lista[E.sug.i]);
        return desenharSug();
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    ta.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); escolherArquivo(f); } });
    $('#compor').addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
    const pr = $('#principal');
    pr.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); if (!$('.soltar')) pr.insertAdjacentHTML('beforeend', '<div class="soltar">Solte aqui para enviar</div>'); } });
    pr.addEventListener('dragleave', (e) => { if (e.target === pr || !pr.contains(e.relatedTarget)) $('.soltar')?.remove(); });
    pr.addEventListener('drop', (e) => { e.preventDefault(); $('.soltar')?.remove(); const f = e.dataTransfer.files[0]; if (f) escolherArquivo(f); });
  }

  function escolherArquivo(f) {
    if (f.size > LIMITE_MB * 1048576) return toast(`O arquivo passou de ${LIMITE_MB} MB.`);
    E.arquivo = f;
    const url = ehImagem(f.type) ? URL.createObjectURL(f) : '';
    $('#previa').innerHTML = `<div class="previa">${url ? `<img src="${url}" alt="">` : `<span class="anexo-doc" style="margin:0;padding:6px"><span class="ext" style="width:32px;height:38px">${esc(f.name.split('.').pop().slice(0, 4))}</span></span>`}
      <div style="flex:1;min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</strong><span class="quieto">${tamanho(f.size)}</span></div>
      <button type="button" class="btn peq" data-a="tirar-anexo">Tirar</button></div>`;
    $('#texto').focus();
  }

  async function enviar() {
    const ta = $('#texto'); const texto = ta.value.trim(); const arquivo = E.arquivo;
    if (!texto && !arquivo) return;
    const b = $('#btn-enviar'); b.disabled = true;
    try {
      const m = await api.enviar({ salaId: E.sala.id, texto, arquivo, eu: E.eu });
      if (!E.msgs.some((x) => x.id === m.id)) { E.msgs.push(m); desenharMensagens(true); }
      ta.value = ''; ta.style.height = 'auto'; E.arquivo = null; $('#previa').innerHTML = '';
      // Chama as IAs com resposta automática que foram mencionadas.
      if (CFG.iaAutomatica !== false && texto) {
        const chamadas = E.membros.filter((x) => x.tipo === 'ia' && x.auto && x.id !== E.eu.id && norm(texto).includes(`@${norm(x.nome)}`));
        chamadas.forEach((ia) => pedirResposta(ia.id));
      }
    } catch (e) { toast(e.message); }
    finally { b.disabled = false; ta.focus(); }
  }

  async function pedirResposta(iaId) {
    E.pensando.add(iaId); atualizarPensando();
    try { await api.pedirIA(E.sala.id, iaId); }
    catch (e) { toast(`${membro(iaId).nome} não conseguiu responder: ${e.message}`); }
    finally { setTimeout(() => { E.pensando.delete(iaId); atualizarPensando(); }, 400); }
  }

  // ---------- @menções ----------
  function sugerir() {
    const ta = $('#texto'); const antes = ta.value.slice(0, ta.selectionStart);
    const m = antes.match(/@([^\s@]{0,20})$/);
    if (!m) return fecharSug();
    const q = norm(m[1]);
    const lista = E.membros.filter((x) => x.id !== E.eu.id && norm(x.nome).replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))).slice(0, 8);
    if (!lista.length) return fecharSug();
    E.sug = { lista, i: 0, inicio: antes.length - m[0].length }; desenharSug();
  }
  function desenharSug() {
    $('.sugestoes')?.remove();
    $('#compor').insertAdjacentHTML('beforeend', `<div class="sugestoes" role="listbox" aria-label="Chamar alguém">${E.sug.lista.map((x, i) => `<button type="button" class="item ${i === E.sug.i ? 'foco' : ''}" role="option" aria-selected="${i === E.sug.i}" data-a="sug" data-id="${esc(x.id)}">${avatar(x, 24)}<span class="nome">${esc(x.nome)}</span>${x.tipo === 'ia' ? `<span class="etq ${x.auto ? 'auto' : ''}">${x.auto ? 'responde sozinha' : 'IA'}</span>` : ''}</button>`).join('')}</div>`);
  }
  function fecharSug() { E.sug = null; $('.sugestoes')?.remove(); }
  function escolherSug(m) {
    const ta = $('#texto'); const pos = ta.selectionStart;
    ta.value = `${ta.value.slice(0, E.sug.inicio)}@${m.nome} ${ta.value.slice(pos)}`;
    const c = E.sug.inicio + m.nome.length + 2; ta.setSelectionRange(c, c); fecharSug(); ta.focus();
  }

  // ---------- janelas ----------
  function janela(html, aoMontar) {
    const f = document.createElement('div'); f.className = 'janela-fundo';
    f.innerHTML = `<div class="janela" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(f);
    const fechar = () => f.remove();
    f.addEventListener('click', (e) => { if (e.target === f || e.target.closest('[data-fechar]')) fechar(); });
    f.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    aoMontar && aoMontar(f, fechar);
    (f.querySelector('input,button.mel,button') || f).focus();
  }
  function fecharMenu() { $('#casca')?.classList.remove('menu-aberto'); }

  // ---------- cliques ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    if (a === 'sala') trocarSala(Number(el.dataset.id));
    else if (a === 'menu') $('#casca').classList.toggle('menu-aberto');
    else if (a === 'anexar') $('#arquivo').click();
    else if (a === 'tirar-anexo') { E.arquivo = null; $('#previa').innerHTML = ''; }
    else if (a === 'sug') escolherSug(membro(el.dataset.id));
    else if (a === 'mencionar') { const m = membro(el.dataset.id); const ta = $('#texto'); ta.value = `${ta.value}${ta.value && !ta.value.endsWith(' ') ? ' ' : ''}@${m.nome} `; ta.focus(); fecharMenu(); }
    else if (a === 'ver-imagem') { e.preventDefault(); janela(`<img class="zoom" src="${esc(el.src)}" alt="${esc(el.alt)}"><div style="display:flex;gap:8px;justify-content:flex-end"><a class="btn" href="${esc(el.src)}" target="_blank" rel="noopener">Abrir em outra aba</a><button class="btn mel" data-fechar>Fechar</button></div>`); $('.janela').style.width = 'auto'; }
    else if (a === 'sair') { await api.sair(); E.eu = null; if (E.pararDeOuvir) E.pararDeOuvir(); telaEntrada(); }
    else if (a === 'nova-sala') {
      janela(`<h2>Nova sala</h2><form id="f-sala" style="display:flex;flex-direction:column;gap:12px"><label class="rotulo">Nome da sala<input class="input" id="nome-sala" required maxlength="40" placeholder="Ex.: Lançamentos"></label><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn mel">Criar</button></div></form>`, (f, fechar) => {
        f.querySelector('#f-sala').onsubmit = async (ev) => {
          ev.preventDefault();
          try { const s = await api.criarSala(f.querySelector('#nome-sala').value.trim(), E.eu); E.salas.push(s); fechar(); trocarSala(s.id); }
          catch (err) { toast(err.message); }
        };
      });
    } else if (a === 'pedir-ia') {
      const ias = E.membros.filter((m) => m.tipo === 'ia' && m.id !== E.eu.id);
      janela(`<h2>Pedir resposta de uma IA</h2><p class="quieto" style="margin:0">A IA lê as últimas mensagens desta sala (com imagens e PDFs recentes) e responde aqui. As que estão marcadas "só pelo Chrome" respondem quando alguém abre o chat na conta delas.</p>
        <div style="display:flex;flex-direction:column;gap:4px">${ias.map((m) => `<button class="item" data-escolher="${esc(m.id)}" ${m.auto ? '' : 'disabled style="opacity:.55;cursor:not-allowed"'}>${avatar(m)}<span class="nome">${esc(m.nome)}</span><span class="etq ${m.auto ? 'auto' : ''}">${m.auto ? 'responde sozinha' : 'só pelo Chrome'}</span></button>`).join('')}</div>
        <div style="display:flex;justify-content:flex-end"><button class="btn" data-fechar>Fechar</button></div>`, (f, fechar) => {
        f.querySelectorAll('[data-escolher]').forEach((b) => { b.onclick = () => { if (b.disabled) return; fechar(); pedirResposta(b.dataset.escolher); }; });
      });
    }
  });
  $('#arquivo').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) escolherArquivo(f); });

  // ---------- início ----------
  (async () => {
    try {
      await api.iniciar();
      const eu = await api.meuMembro();
      if (eu) { E.eu = eu; await abrirChat(); } else telaEntrada();
    } catch (e) { telaEntrada(e.message); }
  })();
})();
