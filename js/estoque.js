// Controle de estoque — Administrador e Estoquista.
//
// Ataca o problema de "perda de alimentos por falta de rastreio de
// validade": lista sempre ordenada por data de validade (regra FEFO —
// First Expired, First Out) e destaca o que vence em até 7 dias.

(function () {
  const { escapeHtml, gerarId, formatarDataBr, diasAte } = window.Util;

  async function render(container) {
    const itens = await window.DBLocal.Estoque.listarOrdenadoPorValidade();

    container.innerHTML = `
      <h2>Estoque</h2>
      <details class="cartao">
        <summary>+ Registrar entrada de item</summary>
        <form id="form-item">
          <label>Nome do item
            <input type="text" id="e-nome" required />
          </label>
          <label>Categoria
            <input type="text" id="e-categoria" placeholder="ex.: grãos, higiene, laticínio" />
          </label>
          <label>Quantidade
            <input type="number" step="0.01" min="0" id="e-quantidade" required value="1" />
          </label>
          <label>Unidade
            <input type="text" id="e-unidade" placeholder="kg, un, L..." value="un" required />
          </label>
          <label>Data de validade
            <input type="date" id="e-validade" />
          </label>
          <button type="submit" class="botao-grande">Adicionar ao estoque</button>
        </form>
      </details>

      <div class="lista-estoque">
        ${
          itens.length
            ? itens.map((item) => linhaItem(item)).join("")
            : "<p>Nenhum item no estoque ainda.</p>"
        }
      </div>
    `;

    document.getElementById("form-item").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      await adicionarItem({
        nome: document.getElementById("e-nome").value.trim(),
        categoria: document.getElementById("e-categoria").value.trim(),
        quantidade: Number(document.getElementById("e-quantidade").value),
        unidade: document.getElementById("e-unidade").value.trim(),
        dataValidade: document.getElementById("e-validade").value || null,
      });
      await render(container);
    });

    container.querySelectorAll("[data-ajustar]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const delta = Number(botao.dataset.delta);
        await ajustarQuantidade(botao.dataset.ajustar, delta);
        await render(container);
      });
    });

    container.querySelectorAll("[data-remover-item]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        if (!confirm("Remover este item do estoque?")) return;
        await removerItem(botao.dataset.removerItem);
        await render(container);
      });
    });
  }

  function linhaItem(item) {
    const dias = diasAte(item.dataValidade);
    let etiqueta = "";
    if (dias !== null) {
      if (dias < 0) etiqueta = '<span class="etiqueta etiqueta-perigo">VENCIDO</span>';
      else if (dias <= 7) etiqueta = `<span class="etiqueta etiqueta-alerta">Vence em ${dias} dia(s) — usar primeiro (FEFO)</span>`;
    }
    return `
      <div class="cartao linha-estoque">
        <div>
          <strong>${escapeHtml(item.nome)}</strong> ${etiqueta}
          <div class="detalhe-secundario">
            ${escapeHtml(item.categoria || "sem categoria")} · ${item.quantidade} ${escapeHtml(item.unidade)} ·
            validade: ${formatarDataBr(item.dataValidade)}
          </div>
        </div>
        <div class="botoes-linha">
          <button class="botao-secundario" data-ajustar="${item.id}" data-delta="-1">− Saída</button>
          <button class="botao-secundario" data-ajustar="${item.id}" data-delta="1">+ Entrada</button>
          <button class="botao-perigo" data-remover-item="${item.id}">Remover</button>
        </div>
      </div>
    `;
  }

  async function salvarNoServidor(item) {
    await window.Sync.enfileirar("itensEstoque", "update", {
      id: item.id,
      nome: item.nome,
      categoria: item.categoria || null,
      quantidade: item.quantidade,
      unidade: item.unidade,
      data_entrada: item.dataEntrada,
      data_validade: item.dataValidade || null,
    });
  }

  async function adicionarItem(dados) {
    if (!dados.nome || !dados.unidade) throw new Error("Preencha nome e unidade.");
    const item = {
      id: gerarId(),
      nome: dados.nome,
      categoria: dados.categoria || null,
      quantidade: dados.quantidade,
      unidade: dados.unidade,
      dataEntrada: new Date().toISOString().slice(0, 10),
      dataValidade: dados.dataValidade,
      sincronizado: false,
    };
    await window.DBLocal.Estoque.upsert(item);
    await salvarNoServidor(item);
  }

  async function ajustarQuantidade(id, delta) {
    const itens = await window.DBLocal.Estoque.listarOrdenadoPorValidade();
    const item = itens.find((i) => i.id === id);
    if (!item) return;
    item.quantidade = Math.max(0, Number(item.quantidade) + delta);
    item.sincronizado = false;
    await window.DBLocal.Estoque.upsert(item);
    await salvarNoServidor(item);
  }

  async function removerItem(id) {
    await window.DBLocal.Estoque.remover(id);
    await window.Sync.enfileirar("itensEstoque", "delete", { id });
  }

  window.TelaEstoque = { render };
})();
