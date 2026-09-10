// Relatórios consolidados por período — tela do Administrador.
//
// Ataca o problema de "impossibilidade de prestar contas": consolida
// entregas por ciclo e exporta CSV/Excel. A exportação para editais/
// diretoria usa a versão AGREGADA (só contagens), evitando expor CPF e
// renda individuais, conforme a LGPD (spec, seção 6.3).

(function () {
  const { escapeHtml, formatarDataBr, celulaCsv, baixarCsv } = window.Util;

  async function montarMapaNomes() {
    const completos = await window.DBLocal.FamiliasCompleto.listar();
    const operacionais = await window.DBLocal.FamiliasOperacional.listar();
    const mapa = new Map();
    operacionais.forEach((f) => mapa.set(f.id, f.nome));
    completos.forEach((f) => mapa.set(f.id, f.nome));
    return mapa;
  }

  function dentroDoPeriodo(ciclo, inicio, fim) {
    if (!ciclo.dataInicio) return true;
    if (inicio && ciclo.dataInicio < inicio) return false;
    if (fim && ciclo.dataInicio > fim) return false;
    return true;
  }

  async function calcularConsolidado(inicio, fim) {
    const ciclos = (await window.DBLocal.Ciclos.listar()).filter((c) => dentroDoPeriodo(c, inicio, fim));
    const todasEntregas = await window.DBLocal.Entregas.listar();

    return ciclos.map((ciclo) => {
      const entregasDoCiclo = todasEntregas.filter((e) => e.cicloId === ciclo.id);
      const familiasUnicas = new Set(entregasDoCiclo.map((e) => e.familiaId));
      return {
        ciclo,
        entregas: entregasDoCiclo,
        totalEntregas: entregasDoCiclo.length,
        totalFamiliasAtendidas: familiasUnicas.size,
      };
    });
  }

  async function render(container) {
    const hoje = new Date().toISOString().slice(0, 10);
    const seisMesesAtras = new Date();
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
    const inicioPadrao = seisMesesAtras.toISOString().slice(0, 10);

    container.innerHTML = `
      <h2>Relatórios e prestação de contas</h2>
      <div class="cartao">
        <form id="form-periodo">
          <label>De
            <input type="date" id="r-inicio" value="${inicioPadrao}" />
          </label>
          <label>Até
            <input type="date" id="r-fim" value="${hoje}" />
          </label>
          <button type="submit" class="botao-grande">Gerar relatório</button>
        </form>
      </div>
      <div id="resultado-relatorio"></div>
    `;

    document.getElementById("form-periodo").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const inicio = document.getElementById("r-inicio").value || null;
      const fim = document.getElementById("r-fim").value || null;
      await renderResultado(inicio, fim);
    });

    await renderResultado(inicioPadrao, hoje);
  }

  async function renderResultado(inicio, fim) {
    const alvo = document.getElementById("resultado-relatorio");
    const consolidado = await calcularConsolidado(inicio, fim);
    const totalGeral = consolidado.reduce((soma, c) => soma + c.totalEntregas, 0);
    const familiasGeral = new Set();
    consolidado.forEach((c) => c.entregas.forEach((e) => familiasGeral.add(e.familiaId)));

    alvo.innerHTML = `
      <div class="cartao">
        <strong>Total de entregas no período:</strong> ${totalGeral} —
        <strong>Famílias atendidas (distintas):</strong> ${familiasGeral.size}
      </div>
      <table class="tabela-relatorio">
        <thead><tr><th>Ciclo</th><th>Início</th><th>Fim</th><th>Entregas</th><th>Famílias atendidas</th></tr></thead>
        <tbody>
          ${
            consolidado
              .map(
                (c) => `
            <tr>
              <td>${escapeHtml(c.ciclo.descricao)}</td>
              <td>${formatarDataBr(c.ciclo.dataInicio)}</td>
              <td>${formatarDataBr(c.ciclo.dataFim)}</td>
              <td>${c.totalEntregas}</td>
              <td>${c.totalFamiliasAtendidas}</td>
            </tr>`
              )
              .join("") || '<tr><td colspan="5">Nenhum ciclo no período selecionado.</td></tr>'
          }
        </tbody>
      </table>
      <div class="botoes-form">
        <button id="botao-csv-agregado" class="botao-grande">Exportar CSV agregado/anonimizado (editais)</button>
        <button id="botao-csv-detalhado" class="botao-secundario">Exportar CSV detalhado (uso interno)</button>
      </div>
    `;

    document
      .getElementById("botao-csv-agregado")
      .addEventListener("click", () => exportarAgregado(consolidado, inicio, fim));
    document
      .getElementById("botao-csv-detalhado")
      .addEventListener("click", () => exportarDetalhado(consolidado, inicio, fim));
  }

  function exportarAgregado(consolidado, inicio, fim) {
    const linhas = [
      ["ciclo", "data_inicio", "data_fim", "total_entregas", "total_familias_atendidas"].join(","),
    ];
    consolidado.forEach((c) => {
      linhas.push(
        [
          celulaCsv(c.ciclo.descricao),
          celulaCsv(c.ciclo.dataInicio),
          celulaCsv(c.ciclo.dataFim || ""),
          celulaCsv(c.totalEntregas),
          celulaCsv(c.totalFamiliasAtendidas),
        ].join(",")
      );
    });
    baixarCsv(`relatorio-agregado-${inicio || "inicio"}-a-${fim || "fim"}.csv`, linhas.join("\r\n"));
  }

  async function exportarDetalhado(consolidado, inicio, fim) {
    const nomes = await montarMapaNomes();
    const linhas = [["ciclo", "data_entrega", "familia", "confirmado_duplicidade"].join(",")];
    consolidado.forEach((c) => {
      c.entregas.forEach((e) => {
        linhas.push(
          [
            celulaCsv(c.ciclo.descricao),
            celulaCsv(e.dataEntrega),
            celulaCsv(nomes.get(e.familiaId) || e.familiaId),
            celulaCsv(e.confirmadoDuplicidade ? "sim" : "não"),
          ].join(",")
        );
      });
    });
    baixarCsv(`relatorio-detalhado-${inicio || "inicio"}-a-${fim || "fim"}.csv`, linhas.join("\r\n"));
  }

  window.TelaRelatorios = { render };
})();
