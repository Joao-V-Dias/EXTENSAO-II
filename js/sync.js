// Sincronização com o Supabase — só roda quando há rede, nunca trava o uso.
//
// Regra de ouro: grava local primeiro (IndexedDB), enfileira o envio, e
// sincroniza sozinho em segundo plano quando o evento `online` dispara.
//
// Regra de LGPD (filtro por perfil): cada papel baixa só o que pode ver.
// Administrador baixa `familias` (completa, e criptografa antes de guardar
// localmente). Estoquista e Voluntário baixam só `familias_operacional`
// (nome + status) — o campo sensível nunca trafega para o dispositivo deles.

(function () {
  const MAPA_TABELAS = {
    familias: "familias",
    itensEstoque: "itens_estoque",
    entregas: "entregas",
    ciclos: "ciclos_distribuicao",
  };

  let sincronizando = false;
  const ouvintes = [];

  function notificar() {
    const estado = { sincronizando };
    ouvintes.forEach((cb) => cb(estado));
  }

  function aoMudar(callback) {
    ouvintes.push(callback);
  }

  function ehErroDeRede(erro) {
    return (
      erro instanceof TypeError ||
      /fetch|network|failed to fetch/i.test((erro && erro.message) || "")
    );
  }

  // ---- conversão camelCase (app/local) <-> snake_case (Postgres) ----

  function cicloParaLocal(c) {
    return {
      id: c.id,
      descricao: c.descricao,
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      ativo: c.ativo,
    };
  }

  function entregaParaLocal(e) {
    return {
      id: e.id,
      familiaId: e.familia_id,
      cicloId: e.ciclo_id,
      dataEntrega: e.data_entrega,
      voluntarioId: e.voluntario_id,
      confirmadoDuplicidade: e.confirmado_duplicidade,
      sincronizado: true,
    };
  }

  function estoqueParaLocal(i) {
    return {
      id: i.id,
      nome: i.nome,
      categoria: i.categoria,
      quantidade: i.quantidade,
      unidade: i.unidade,
      dataEntrada: i.data_entrada,
      dataValidade: i.data_validade,
      sincronizado: true,
    };
  }

  async function enviarItem(item) {
    const { tabela, tipo, payload } = item;
    const client = window.Auth.supabaseClient;

    if (tabela === "familias" && tipo === "excluir_lgpd") {
      const { error } = await client.rpc("excluir_dados_familia", { p_familia_id: payload.id });
      if (error) throw error;
      return;
    }

    if (tipo === "delete") {
      const { error } = await client.from(MAPA_TABELAS[tabela]).delete().eq("id", payload.id);
      if (error) throw error;
      return;
    }

    const { error } = await client.from(MAPA_TABELAS[tabela]).upsert(payload, { onConflict: "id" });
    if (error) throw error;
  }

  async function processarFila() {
    const client = window.Auth.supabaseClient;
    if (!client || !navigator.onLine || sincronizando) return;

    sincronizando = true;
    notificar();
    try {
      const fila = await window.DBLocal.FilaSaida.listar();
      for (const item of fila) {
        try {
          await enviarItem(item);
          await window.DBLocal.FilaSaida.remover(item.localId);
        } catch (erro) {
          if (ehErroDeRede(erro)) {
            break; // sem rede: para e tenta tudo de novo mais tarde
          }
          console.error("Prato Cheio: item da fila rejeitado pelo servidor, descartando.", item, erro);
          await window.DBLocal.FilaSaida.remover(item.localId);
        }
      }
      await puxarAtualizacoes();
    } finally {
      sincronizando = false;
      notificar();
    }
  }

  async function puxarAtualizacoes() {
    const client = window.Auth.supabaseClient;
    if (!client || !navigator.onLine) return;
    const papel = window.Auth.getPapel();
    if (!papel) return;

    const [ciclosRes, entregasRes] = await Promise.all([
      client.from("ciclos_distribuicao").select("*"),
      client.from("entregas_operacional").select("*"),
    ]);
    if (!ciclosRes.error) {
      await window.DBLocal.Ciclos.substituirTodos(ciclosRes.data.map(cicloParaLocal));
    }
    if (!entregasRes.error) {
      await window.DBLocal.Entregas.substituirTodas(entregasRes.data.map(entregaParaLocal));
    }

    if (papel === "admin") {
      const { data, error } = await client.from("familias").select("*");
      if (!error) {
        const registros = [];
        for (const f of data) {
          const registro = { id: f.id, nome: f.nome, ativa: f.ativa };
          if (window.Cripto.estaDesbloqueado()) {
            registro.sensivelCripto = await window.Cripto.criptografarObjeto({
              cpf: f.cpf,
              renda: f.renda,
              numeroDependentes: f.numero_dependentes,
              fotoUrl: f.foto_url,
              consentimento: f.consentimento,
              consentimentoData: f.consentimento_data,
              consentimentoFinalidade: f.consentimento_finalidade,
              dataCadastro: f.data_cadastro,
            });
          }
          registros.push(registro);
        }
        await window.DBLocal.FamiliasCompleto.substituirTodas(registros);
        // Também mantém a view operacional local em dia para o admin poder
        // usar a mesma tela de Entregas (busca por nome) que os outros papéis.
        await window.DBLocal.FamiliasOperacional.substituirTodas(
          data.map((f) => ({ id: f.id, nome: f.nome, ativa: f.ativa }))
        );
      }
    } else {
      const { data, error } = await client.from("familias_operacional").select("*");
      if (!error) await window.DBLocal.FamiliasOperacional.substituirTodas(data);
    }

    if (papel === "admin" || papel === "estoquista") {
      const { data, error } = await client.from("itens_estoque").select("*");
      if (!error) await window.DBLocal.Estoque.substituirTodos(data.map(estoqueParaLocal));
    }

    await window.DBLocal.setSessao("ultimaSincronizacao", new Date().toISOString());
    notificar();
  }

  async function enfileirar(tabela, tipo, payload) {
    await window.DBLocal.FilaSaida.enfileirar({ tabela, tipo, payload });
    notificar();
    if (navigator.onLine) processarFila();
  }

  async function contarPendentes() {
    return window.DBLocal.FilaSaida.contar();
  }

  async function ultimaSincronizacao() {
    return window.DBLocal.getSessao("ultimaSincronizacao");
  }

  function init() {
    window.addEventListener("online", () => processarFila());
    // Reforço periódico: cobre o caso de a rede voltar sem disparar o
    // evento (comum em 3G/4G instável) — nunca bloqueia a interface.
    setInterval(() => {
      if (navigator.onLine) processarFila();
    }, 60000);
    if (navigator.onLine) processarFila();
  }

  window.Sync = {
    init,
    processarFila,
    puxarAtualizacoes,
    enfileirar,
    contarPendentes,
    ultimaSincronizacao,
    aoMudar,
  };
})();
