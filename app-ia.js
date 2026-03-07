/**
 * app-ia.js — Módulo de Inteligência Artificial
 * CH Geladas PDV — Análise e sugestões via Claude API
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   SERVIÇO DE ANÁLISE IA
   ═══════════════════════════════════════════════════════════ */
const IAService = (() => {

  const MODEL   = 'claude-sonnet-4-20250514';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  /* ── Construir contexto completo do negócio ─────────────── */
  function _buildContext() {
    const estoque    = Store.Selectors.getEstoque()    || [];
    const vendas     = Store.Selectors.getVendas()     || [];
    const caixa      = Store.Selectors.getCaixa()      || [];
    const ponto      = Store.Selectors.getPonto()      || [];
    const inventario = Store.Selectors.getInventario() || [];
    const delivery   = Store.Selectors.getDelivery()  || {};
    const config     = Store.Selectors.getConfig()     || {};
    const investimento = Store.Selectors.getInvestimento() || 0;
    const lowStock   = Store.Selectors.getLowStockItems()    || [];
    const semStock   = Store.Selectors.getOutOfStockItems()  || [];
    const comandas   = (window._state?.comandas) || [];

    // --- Vendas ---
    const totalReceita = vendas.reduce((s, v) => s + (v.total || 0), 0);
    const totalCusto   = vendas.reduce((s, v) => {
      return s + (v.itens || []).reduce((si, it) => si + ((it.custoUn || 0) * (it.qtd || 1)), 0);
    }, 0);
    const lucroEstimado = totalReceita - totalCusto;

    // Top produtos
    const contagemProd = {};
    vendas.forEach(v => (v.itens || []).forEach(it => {
      if (!contagemProd[it.nome]) contagemProd[it.nome] = { qtd: 0, receita: 0 };
      contagemProd[it.nome].qtd     += it.qtd || 1;
      contagemProd[it.nome].receita += (it.precoUn || 0) * (it.qtd || 1);
    }));
    const topProdutos = Object.entries(contagemProd)
      .sort((a, b) => b[1].qtd - a[1].qtd)
      .slice(0, 10)
      .map(([nome, d]) => ({ nome, qtd: d.qtd, receita: Number(d.receita.toFixed(2)) }));

    // Vendas por dia da semana
    const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const porDia = Array(7).fill(0);
    vendas.forEach(v => {
      const d = new Date(v.data || v.ts || Date.now());
      porDia[d.getDay()]++;
    });
    const vendasPorDia = porDia.map((total, i) => ({ dia: diasSemana[i], total }));

    // Vendas por hora
    const porHora = Array(24).fill(0);
    vendas.forEach(v => {
      const h = new Date(v.data || v.ts || Date.now()).getHours();
      porHora[h]++;
    });
    const horasPico = porHora
      .map((total, h) => ({ hora: `${h}h`, total }))
      .filter(h => h.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Margem média
    const margemMedia = estoque.length
      ? (estoque.reduce((s, p) => {
          return s + (p.precoUn > 0 ? (1 - (p.custoUn || 0) / p.precoUn) * 100 : 0);
        }, 0) / estoque.length).toFixed(1)
      : 0;

    // Último caixa
    const ultimoCaixa = caixa[0] || null;
    const caixaAberto = ultimoCaixa?.tipo === 'ABERTURA';

    // Ponto (horas trabalhadas)
    const totalEntradas  = ponto.filter(p => p.tipo === 'ENTRADA').length;
    const totalSaidas    = ponto.filter(p => p.tipo === 'SAIDA').length;

    // Delivery
    const pedidos        = delivery.pedidos || [];
    const pedidosPendentes = pedidos.filter(p => p.status !== 'entregue').length;

    return {
      estabelecimento: config.nome || 'CH Geladas',
      data: new Date().toLocaleDateString('pt-PT', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
      resumo: {
        totalProdutos:   estoque.length,
        totalVendas:     vendas.length,
        receita:         Number(totalReceita.toFixed(2)),
        lucroEstimado:   Number(lucroEstimado.toFixed(2)),
        investimento,
        margemMedia:     Number(margemMedia),
        caixaAberto,
        totalEntradas,
        totalSaidas,
        pedidosDelivery: pedidos.length,
        pedidosPendentes,
        totalInventarios: inventario.length,
        totalComandas:   comandas.length,
      },
      stock: {
        totalProdutos:   estoque.length,
        produtosAtivos:  estoque.filter(p => p.qtdUn > 0).length,
        esgotados:       semStock.map(p => ({ nome: p.nome, precoUn: p.precoUn })),
        baixoStock:      lowStock.map(p => ({ nome: p.nome, qtd: p.qtdUn, min: config.alertaStock || 3 })),
        topValorStock:   [...estoque]
          .sort((a,b) => (b.qtdUn * b.precoUn) - (a.qtdUn * a.precoUn))
          .slice(0,5)
          .map(p => ({ nome: p.nome, valor: Number((p.qtdUn * p.precoUn).toFixed(2)), qtd: p.qtdUn })),
        categorias:      config.categorias || [],
      },
      vendas: {
        total:       vendas.length,
        topProdutos,
        vendasPorDia,
        horasPico,
        ultimasVendas: vendas.slice(-5).map(v => ({
          total: v.total,
          itens: (v.itens || []).length,
          data:  new Date(v.data || v.ts || Date.now()).toLocaleString('pt-PT')
        }))
      },
      delivery: {
        totalPedidos:    pedidos.length,
        pendentes:       pedidosPendentes,
        entregadores:    (delivery.entregadores || []).length,
        zonas:           (delivery.zonas || []).map(z => z.nome || z),
      }
    };
  }

  /* ── Chamar API Claude ──────────────────────────────────── */
  async function analisar(pergunta = null) {
    const ctx = _buildContext();

    const systemPrompt = `És o assistente de IA do PDV "${ctx.estabelecimento}", um sistema de ponto de venda para bar/restaurante/loja.
O teu papel é analisar os dados do negócio e dar sugestões concretas, práticas e accionáveis em português europeu.

DADOS ACTUAIS DO NEGÓCIO (${ctx.data}):
${JSON.stringify(ctx, null, 2)}

INSTRUÇÕES:
- Responde SEMPRE em português europeu (não brasileiro)
- Sê directo e prático — o dono quer acção, não teoria
- Usa emojis para tornar a leitura mais fácil
- Quando vires problemas, sugere soluções específicas
- Quando vires oportunidades, quantifica o potencial impacto
- Organiza a resposta em secções claras com títulos
- Para análise geral: cobre stock, vendas, financeiro, operações e delivery
- Máximo 600 palavras na resposta`;

    const userMessage = pergunta
      ? pergunta
      : `Faz uma análise completa do meu negócio hoje. Identifica os principais problemas, oportunidades e dá-me as top 5 sugestões prioritárias para melhorar o desempenho.`;

    const apiKey = Store.Selectors.getConfig()?.anthropicApiKey || '';
    if (!apiKey) {
      throw new Error('Chave da API não configurada. Acede às ⚙️ Configurações e insere a tua API Key da Anthropic.');
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erro HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.content?.map(b => b.text || '').join('') || '';
  }

  return { analisar, _buildContext };
})();


/* ═══════════════════════════════════════════════════════════
   RENDERIZAÇÃO DO PAINEL IA
   ═══════════════════════════════════════════════════════════ */
const IARenderer = (() => {

  let _mensagens = []; // histórico da conversa
  let _analisando = false;

  /* ── Render principal ───────────────────────────────────── */
  function renderIA() {
    const panel = Utils.el('tab-ia');
    if (!panel) return;

    const ctx   = IAService._buildContext();
    const nome  = ctx.estabelecimento;
    const stats = ctx.resumo;

    panel.innerHTML = `
      <div class="max-w-2xl mx-auto space-y-4">

        <!-- Header IA -->
        <div class="glass rounded-[1.75rem] p-6 relative overflow-hidden">
          <div class="absolute inset-0 bg-gradient-to-br from-violet-900/20 via-blue-900/10 to-transparent pointer-events-none"></div>
          <div class="relative">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <i class="fas fa-robot text-white text-sm"></i>
              </div>
              <div>
                <h2 class="text-sm font-black text-white">Assistente IA</h2>
                <p class="text-[10px] text-violet-400 font-bold">Análise inteligente · ${nome}</p>
              </div>
              <div class="ml-auto">
                <span class="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black px-3 py-1 rounded-full">
                  <span class="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>ONLINE
                </span>
              </div>
            </div>
            <p class="text-[10px] text-slate-400 leading-relaxed">
              Analiso os teus dados em tempo real e dou sugestões para aumentar vendas, controlar stock e optimizar operações.
            </p>
          </div>
        </div>

        <!-- Mini Stats -->
        <div class="grid grid-cols-4 gap-2">
          ${_miniStat('fas fa-shopping-cart', stats.totalVendas, 'Vendas', 'blue')}
          ${_miniStat('fas fa-euro-sign', Utils.formatCurrency(stats.receita), 'Receita', 'emerald')}
          ${_miniStat('fas fa-box-open', Store.Selectors.getLowStockItems().length, 'Stock Baixo', Store.Selectors.getLowStockItems().length > 0 ? 'amber' : 'slate')}
          ${_miniStat('fas fa-truck', stats.pedidosPendentes, 'Delivery', stats.pedidosPendentes > 0 ? 'violet' : 'slate')}
        </div>

        <!-- Botões rápidos -->
        <div class="grid grid-cols-2 gap-2">
          <button onclick="IARenderer.analisarGeral()" class="glass rounded-2xl p-4 text-left hover:border-violet-500/30 border border-white/5 transition-all group">
            <i class="fas fa-chart-line text-violet-400 mb-2 block text-base group-hover:scale-110 transition-transform"></i>
            <p class="text-[11px] font-black text-white">Análise Completa</p>
            <p class="text-[9px] text-slate-500 font-bold mt-0.5">Visão geral do negócio</p>
          </button>
          <button onclick="IARenderer.analisarStock()" class="glass rounded-2xl p-4 text-left hover:border-amber-500/30 border border-white/5 transition-all group">
            <i class="fas fa-boxes text-amber-400 mb-2 block text-base group-hover:scale-110 transition-transform"></i>
            <p class="text-[11px] font-black text-white">Análise de Stock</p>
            <p class="text-[9px] text-slate-500 font-bold mt-0.5">O que comprar e o quê evitar</p>
          </button>
          <button onclick="IARenderer.analisarVendas()" class="glass rounded-2xl p-4 text-left hover:border-emerald-500/30 border border-white/5 transition-all group">
            <i class="fas fa-trending-up text-emerald-400 mb-2 block text-base group-hover:scale-110 transition-transform"></i>
            <p class="text-[11px] font-black text-white">Análise de Vendas</p>
            <p class="text-[9px] text-slate-500 font-bold mt-0.5">Padrões e oportunidades</p>
          </button>
          <button onclick="IARenderer.analisarFinanceiro()" class="glass rounded-2xl p-4 text-left hover:border-blue-500/30 border border-white/5 transition-all group">
            <i class="fas fa-coins text-blue-400 mb-2 block text-base group-hover:scale-110 transition-transform"></i>
            <p class="text-[11px] font-black text-white">Saúde Financeira</p>
            <p class="text-[9px] text-slate-500 font-bold mt-0.5">Margens, lucro e caixa</p>
          </button>
        </div>

        <!-- Chat / Respostas -->
        <div id="iaChatBox" class="space-y-3 min-h-[20px]"></div>

        <!-- Input pergunta livre -->
        <div class="glass rounded-[1.75rem] p-4">
          <p class="text-[9px] text-slate-500 uppercase font-black mb-3 tracking-widest">💬 Pergunta livre</p>
          <div class="flex gap-2">
            <input type="text" id="iaPergunta" class="inp flex-1 text-[12px]"
              placeholder="Ex: Que produtos devo promover este fim-de-semana?"
              onkeydown="if(event.key==='Enter') IARenderer.perguntarLivre()">
            <button onclick="IARenderer.perguntarLivre()"
              class="bg-violet-600 hover:bg-violet-500 text-white px-5 rounded-2xl font-black text-xs transition-all flex-shrink-0 flex items-center gap-2">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>

        <!-- Limpar histórico -->
        <div class="text-center pb-2" id="iaBtnLimpar" style="display:none">
          <button onclick="IARenderer.limparChat()" class="text-[10px] text-slate-600 hover:text-slate-400 font-bold transition-colors">
            <i class="fas fa-trash mr-1"></i>Limpar conversa
          </button>
        </div>

      </div>`;
  }

  function _miniStat(icon, valor, label, cor) {
    const cores = {
      blue:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
      emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      amber:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
      violet:  'text-violet-400 bg-violet-500/10 border-violet-500/20',
      slate:   'text-slate-500 bg-slate-800/50 border-white/5',
    };
    const cls = cores[cor] || cores.slate;
    return `
      <div class="glass rounded-2xl p-3 border ${cls} text-center">
        <i class="${icon} text-base mb-1 block"></i>
        <p class="text-sm font-black">${valor}</p>
        <p class="text-[8px] font-bold opacity-70 uppercase">${label}</p>
      </div>`;
  }

  /* ── Adicionar mensagem ao chat ─────────────────────────── */
  function _addMensagem(tipo, conteudo) {
    _mensagens.push({ tipo, conteudo, ts: Date.now() });
    _renderChat();
  }

  function _renderChat() {
    const box = Utils.el('iaChatBox');
    if (!box) return;

    const limpar = Utils.el('iaBtnLimpar');
    if (limpar) limpar.style.display = _mensagens.length ? '' : 'none';

    box.innerHTML = _mensagens.map(m => {
      if (m.tipo === 'loading') {
        return `<div class="glass rounded-2xl p-5 border border-violet-500/20 animate-pulse">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <i class="fas fa-robot text-violet-400 text-xs"></i>
            </div>
            <div class="space-y-2 flex-1">
              <div class="h-2 bg-slate-700 rounded animate-pulse w-3/4"></div>
              <div class="h-2 bg-slate-700 rounded animate-pulse w-1/2"></div>
              <div class="h-2 bg-slate-700 rounded animate-pulse w-2/3"></div>
            </div>
          </div>
          <p class="text-[10px] text-violet-400 font-bold mt-3 animate-pulse">🤖 A analisar dados...</p>
        </div>`;
      }

      if (m.tipo === 'user') {
        return `<div class="flex justify-end">
          <div class="bg-violet-600/20 border border-violet-500/30 rounded-2xl rounded-tr-md px-4 py-3 max-w-[85%]">
            <p class="text-[11px] font-bold text-violet-200">${_escapeHtml(m.conteudo)}</p>
          </div>
        </div>`;
      }

      if (m.tipo === 'erro') {
        return `<div class="glass rounded-2xl p-4 border border-red-500/20">
          <p class="text-[11px] text-red-400 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${_escapeHtml(m.conteudo)}</p>
        </div>`;
      }

      // resposta IA
      const html = _markdownSimples(m.conteudo);
      return `<div class="glass rounded-2xl p-5 border border-violet-500/15 relative overflow-hidden">
        <div class="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-violet-500 to-blue-500 rounded-l-2xl"></div>
        <div class="flex items-center gap-2 mb-4 pl-3">
          <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
            <i class="fas fa-robot text-white text-[10px]"></i>
          </div>
          <span class="text-[10px] font-black text-violet-400 uppercase tracking-wide">Assistente IA</span>
          <span class="text-[9px] text-slate-600 ml-auto">${new Date(m.ts).toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' })}</span>
        </div>
        <div class="pl-3 ia-resposta text-[11px] leading-relaxed text-slate-300 space-y-2">${html}</div>
      </div>`;
    }).join('');

    // Auto-scroll
    box.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ── Markdown simples → HTML ────────────────────────────── */
  function _markdownSimples(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Headers
      .replace(/^### (.+)$/gm, '<h4 class="text-[12px] font-black text-white mt-4 mb-1">$1</h4>')
      .replace(/^## (.+)$/gm,  '<h3 class="text-[13px] font-black text-violet-300 mt-4 mb-2">$1</h3>')
      .replace(/^# (.+)$/gm,   '<h2 class="text-[14px] font-black text-white mt-3 mb-2">$1</h2>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-black text-white">$1</strong>')
      // Listas
      .replace(/^[-•] (.+)$/gm, '<div class="flex gap-2 items-start"><span class="text-violet-400 mt-0.5 flex-shrink-0">▸</span><span>$1</span></div>')
      .replace(/^\d+\. (.+)$/gm, '<div class="flex gap-2 items-start"><span class="text-blue-400 mt-0.5 flex-shrink-0 font-black text-[10px]">→</span><span>$1</span></div>')
      // Linha horizontal
      .replace(/^---$/gm, '<hr class="border-white/10 my-3">')
      // Parágrafos
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n/g, '<br>');
  }

  function _escapeHtml(t) {
    return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Acções públicas ────────────────────────────────────── */
  async function _executarAnalise(pergunta, labelUser) {
    if (_analisando) { UIService.showToast('A analisar...', 'Aguarda a resposta actual', 'warning'); return; }
    _analisando = true;

    if (labelUser) _addMensagem('user', labelUser);
    _addMensagem('loading', '');

    try {
      const resp = await IAService.analisar(pergunta);
      // remover loading
      _mensagens = _mensagens.filter(m => m.tipo !== 'loading');
      _addMensagem('ia', resp);
    } catch (e) {
      _mensagens = _mensagens.filter(m => m.tipo !== 'loading');
      _addMensagem('erro', `Erro ao contactar IA: ${e.message}`);
    } finally {
      _analisando = false;
    }
  }

  function analisarGeral() {
    _executarAnalise(null, '📊 Quero uma análise completa do meu negócio');
  }

  function analisarStock() {
    _executarAnalise(
      'Analisa apenas o stock do negócio. Identifica: produtos esgotados, produtos com stock baixo, produtos que estão a ocupar capital parado, e dá sugestões de compra e pricing para optimizar o inventário.',
      '📦 Analisa o meu stock e diz-me o que fazer'
    );
  }

  function analisarVendas() {
    _executarAnalise(
      'Analisa as vendas do negócio. Identifica: os produtos mais e menos vendidos, os melhores dias e horas, padrões de consumo, e sugere estratégias para aumentar o ticket médio e as vendas totais.',
      '📈 Analisa as minhas vendas e tendências'
    );
  }

  function analisarFinanceiro() {
    _executarAnalise(
      'Faz uma análise financeira detalhada. Analisa: margens de lucro por produto, receita vs custo, retorno do investimento, saúde do caixa, e dá recomendações para melhorar a rentabilidade.',
      '💰 Analisa a saúde financeira do meu negócio'
    );
  }

  function perguntarLivre() {
    const inp = Utils.el('iaPergunta');
    const q   = (inp?.value || '').trim();
    if (!q) return;
    if (inp) inp.value = '';
    _executarAnalise(q, q);
  }

  function limparChat() {
    _mensagens = [];
    _renderChat();
  }

  return { renderIA, analisarGeral, analisarStock, analisarVendas, analisarFinanceiro, perguntarLivre, limparChat };
})();


/* ═══════════════════════════════════════════════════════════
   FUNÇÕES GLOBAIS
   ═══════════════════════════════════════════════════════════ */
function renderIA() { IARenderer.renderIA(); }
