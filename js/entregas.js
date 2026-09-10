// Registro de entregas — todos os papéis (foco no Voluntário).
//
// Ataca o problema de "distribuição falha": vincula a entrega a uma
// família e a um ciclo, marca quem já foi atendido, e trava/avisa
// duplicidade antes de registrar duas entregas para a mesma família no
// mesmo ciclo (o servidor também garante isso — ver schema.sql).

(function () {
  const { escapeHtml, gerarId, formatarDataBr } = window.Util;

  let filtroBusca = "";

  async function render(container) {
    const papel = window.Auth.getPapel();
    const ciclos = await window.DBLocal.Ciclos.listar();
    let cicloAtivo = ciclos.find((c) => c.ativo) || null;
    const familias = await window.DBLocal.FamiliasOperacional.listar();
    const entregasDoCiclo = cicloAtivo ? await window.DBLocal.Entregas.listarPorCiclo(cicloAtivo.id) : [];

    const idsAtendidos = new Set(entregasDoCiclo.map((e) => e.familiaId));
    const totalAtendidas = idsAtendidos.size;

    container.innerHTML = `
      <h2>Entregas</h2>

      ${
        !cicloAtivo
          ? `<div class="cartao mensagem-alerta">Nenhum ciclo de distribuição ativo no momento.
             ${papel === "admin" ? "Crie um ciclo abaixo para começar a registrar entregas." : "Peça ao administrador para abrir um novo ciclo."}</div>`
          : `<div class="cartao">
              <strong>Ciclo ativo:</strong> ${escapeHtml(cicloAtivo.descricao)}
              (${formatarDataBr(cicloAtivo.dataInicio)}${cicloAtivo.dataFim ? " a " + formatarDataBr(cicloAtivo.dataFim) : ""})
              <div class="detalhe-secundario">${totalAtendidas} de ${familias.length} famílias atendidas neste ciclo</div>
            </div>`
      }

      ${papel === "admin" ? renderFormNovoCiclo() : ""}

      ${
        cicloAtivo
          ? `
        <label class="campo-busca">Buscar família por nome
          <input type="text" id="busca-familia" placeholder="digite o nome..." value="${escapeHtml(filtroBusca)}" />
        </label>
        <div class="lista-entregas">
          ${familias
            .filter((f) => f.nome.toLowerCase().includes(filtroBusca.toLowerCase()))
            .map((f) => linhaFamilia(f, idsAtendidos.has(f.id)))
            .join("") || "<p>Nenhuma família encontrada.</p>"}
        </div>`
          : ""
      }
    `;

    if (papel === "admin") {
      document.getElementById("form-ciclo").addEventListener("submit", async (evento) => {
        evento.preventDefault();
        await criarCiclo({
          descricao: document.getElementById("c-descricao").value.trim(),
          dataInicio: document.getElementById("c-inicio").value,
          dataFim: document.getElementById("c-fim").value || null,
        });
        await render(container);
      });
    }

    if (cicloAtivo) {
      const campoBusca = document.getElementById("busca-familia");
      campoBusca.addEventListener("input", (evento) => {
        filtroBusca = evento.target.value;
        render(container);
      });
      // Mantém o foco no campo de busca após o re-render.
      campoBusca.focus();
      campoBusca.selectionStart = campoBusca.selectionEnd = campoBusca.value.length;

      container.querySelectorAll("[data-registrar]").forEach((botao) => {
        botao.addEventListener("click", async () => {
          await registrarEntregaComVerificacao(botao.dataset.registrar, botao.dataset.nome, cicloAtivo.id);
          await render(container);
        });
      });
    }
  }

  function renderFormNovoCiclo() {
    return `
      <details class="cartao">
        <summary>+ Novo ciclo de distribuição</summary>
        <form id="form-ciclo">
          <label>Descrição
            <input type="text" id="c-descricao" placeholder="ex.: Ciclo Setembro/2026" required />
          </label>
          <label>Data de início
            <input type="date" id="c-inicio" required value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <label>Data de término (opcional)
            <input type="date" id="c-fim" />
          </label>
          <button type="submit" class="botao-grande">Abrir ciclo (encerra o atual)</button>
        </form>
      </details>
    `;
  }

  function linhaFamilia(familia, atendida) {
    return `
      <div class="cartao linha-familia ${atendida ? "linha-atendida" : ""}">
        <div>
          <strong>${escapeHtml(familia.nome)}</strong>
          ${atendida ? '<span class="etiqueta etiqueta-sucesso">Atendida no ciclo</span>' : '<span class="etiqueta">Pendente</span>'}
        </div>
        <button class="botao-grande" data-registrar="${familia.id}" data-nome="${escapeHtml(familia.nome)}">
          Registrar entrega
        </button>
      </div>
    `;
  }

  async function criarCiclo(dados) {
    if (!dados.descricao || !dados.dataInicio) throw new Error("Preencha descrição e data de início.");

    const ciclos = await window.DBLocal.Ciclos.listar();
    for (const antigo of ciclos.filter((c) => c.ativo)) {
      antigo.ativo = false;
      await window.DBLocal.Ciclos.upsert(antigo);
      await window.Sync.enfileirar("ciclos", "update", {
        id: antigo.id,
        descricao: antigo.descricao,
        data_inicio: antigo.dataInicio,
        data_fim: antigo.dataFim,
        ativo: false,
      });
    }

    const novo = {
      id: gerarId(),
      descricao: dados.descricao,
      dataInicio: dados.dataInicio,
      dataFim: dados.dataFim,
      ativo: true,
    };
    await window.DBLocal.Ciclos.upsert(novo);
    await window.Sync.enfileirar("ciclos", "insert", {
      id: novo.id,
      descricao: novo.descricao,
      data_inicio: novo.dataInicio,
      data_fim: novo.dataFim,
      ativo: true,
    });
  }

  async function registrarEntregaComVerificacao(familiaId, nomeFamilia, cicloId) {
    const existentes = await window.DBLocal.Entregas.buscarPorFamiliaCiclo(familiaId, cicloId);
    let confirmarDuplicidade = false;

    if (existentes.length > 0) {
      const ultima = existentes[existentes.length - 1];
      const confirmado = confirm(
        `Atenção: "${nomeFamilia}" já recebeu cesta neste ciclo em ${formatarDataBr(ultima.dataEntrega)}.\n\n` +
          "Registrar mesmo assim uma nova entrega (duplicidade)?"
      );
      if (!confirmado) return;
      confirmarDuplicidade = true;
    }

    const usuario = window.Auth.getUsuario();
    const entrega = {
      id: gerarId(),
      familiaId,
      cicloId,
      dataEntrega: new Date().toISOString(),
      voluntarioId: usuario ? usuario.id : null,
      confirmadoDuplicidade: confirmarDuplicidade,
      sincronizado: false,
    };

    await window.DBLocal.Entregas.upsert(entrega);
    await window.Sync.enfileirar("entregas", "insert", {
      id: entrega.id,
      familia_id: entrega.familiaId,
      ciclo_id: entrega.cicloId,
      data_entrega: entrega.dataEntrega,
      voluntario_id: entrega.voluntarioId,
      itens: [],
      confirmado_duplicidade: entrega.confirmadoDuplicidade,
    });
  }

  window.TelaEntregas = { render };
})();
