// Camada de banco local (offline-first) usando Dexie/IndexedDB.
//
// Regra de ouro: o app sempre lê e grava aqui primeiro. A rede (Supabase)
// é só para sincronizar quando há sinal — nunca é pré-requisito para operar.
//
// Regra de LGPD: cada tabela local só deve receber os dados que o papel do
// usuário logado tem permissão de ver. `familias` (dado completo, sensível)
// só é populada quando o usuário logado é 'admin' — e seus campos sensíveis
// ficam criptografados (ver cripto.js). Voluntário e estoquista usam
// `familiasOperacional`, que nunca tem CPF/renda/foto/dependentes.

(function () {
  const db = new Dexie("PratoCheioDB");

  db.version(1).stores({
    // key-value simples: sessão do usuário, config do dispositivo, timestamps
    sessao: "chave",

    // Dado completo e sensível — só existe no dispositivo do Administrador.
    // `sensivelCripto` guarda { iv, dados } (ver cripto.js); nome/ativa
    // ficam em claro só para permitir listar/buscar sem precisar do PIN.
    familias: "id, nome",

    // View operacional — nunca tem campo sensível. Usada por todos os papéis.
    // `ativa` é gravada como 0/1 (IndexedDB não indexa booleanos).
    familiasOperacional: "id, nome, ativa",

    ciclos: "id, dataInicio",

    itensEstoque: "id, dataValidade, nome",

    entregas: "id, [familiaId+cicloId], cicloId, familiaId",

    // Outbox: operações locais pendentes de envio ao servidor.
    filaSaida: "++localId, criadoEm, tabela",
  });

  async function getSessao(chave) {
    const registro = await db.sessao.get(chave);
    return registro ? registro.valor : undefined;
  }

  async function setSessao(chave, valor) {
    await db.sessao.put({ chave, valor });
  }

  async function limparDadosDoPapel() {
    // Ao trocar de usuário/perfil no mesmo dispositivo, limpamos o cache
    // operacional e sensível para não misturar dados entre sessões.
    await db.familias.clear();
    await db.familiasOperacional.clear();
    await db.ciclos.clear();
    await db.itensEstoque.clear();
    await db.entregas.clear();
    await db.filaSaida.clear();
  }

  const FamiliasCompleto = {
    async listar() {
      return db.familias.orderBy("nome").toArray();
    },
    async obter(id) {
      return db.familias.get(id);
    },
    async upsert(registro) {
      return db.familias.put(registro);
    },
    async remover(id) {
      return db.familias.delete(id);
    },
    async substituirTodas(lista) {
      await db.familias.clear();
      await db.familias.bulkPut(lista);
    },
  };

  const FamiliasOperacional = {
    async listar() {
      return db.familiasOperacional.where("ativa").equals(1).sortBy("nome");
    },
    async upsert(registro) {
      return db.familiasOperacional.put({ ...registro, ativa: registro.ativa ? 1 : 0 });
    },
    async remover(id) {
      return db.familiasOperacional.delete(id);
    },
    async substituirTodas(lista) {
      await db.familiasOperacional.clear();
      await db.familiasOperacional.bulkPut(
        lista.map((f) => ({ ...f, ativa: f.ativa ? 1 : 0 }))
      );
    },
  };

  const Ciclos = {
    async listar() {
      return db.ciclos.orderBy("dataInicio").reverse().toArray();
    },
    async obterAtivo() {
      const todos = await db.ciclos.toArray();
      return todos.find((c) => c.ativo) || null;
    },
    async substituirTodos(lista) {
      await db.ciclos.clear();
      await db.ciclos.bulkPut(lista);
    },
    async upsert(ciclo) {
      return db.ciclos.put(ciclo);
    },
  };

  const Estoque = {
    async listarOrdenadoPorValidade() {
      // FEFO: o que vence primeiro aparece primeiro. Itens sem validade vão
      // para o final da lista.
      const todos = await db.itensEstoque.toArray();
      return todos.sort((a, b) => {
        if (!a.dataValidade) return 1;
        if (!b.dataValidade) return -1;
        return a.dataValidade.localeCompare(b.dataValidade);
      });
    },
    async upsert(item) {
      return db.itensEstoque.put(item);
    },
    async remover(id) {
      return db.itensEstoque.delete(id);
    },
    async substituirTodos(lista) {
      await db.itensEstoque.clear();
      await db.itensEstoque.bulkPut(lista);
    },
  };

  const Entregas = {
    async listar() {
      return db.entregas.toArray();
    },
    async listarPorCiclo(cicloId) {
      return db.entregas.where("cicloId").equals(cicloId).toArray();
    },
    async buscarPorFamiliaCiclo(familiaId, cicloId) {
      return db.entregas
        .where("[familiaId+cicloId]")
        .equals([familiaId, cicloId])
        .toArray();
    },
    async existeEntrega(familiaId, cicloId) {
      const registros = await this.buscarPorFamiliaCiclo(familiaId, cicloId);
      return registros.length > 0;
    },
    async upsert(entrega) {
      return db.entregas.put(entrega);
    },
    async substituirTodas(lista) {
      await db.entregas.clear();
      await db.entregas.bulkPut(lista);
    },
  };

  const FilaSaida = {
    async enfileirar(operacao) {
      return db.filaSaida.add({
        ...operacao,
        criadoEm: new Date().toISOString(),
      });
    },
    async listar() {
      return db.filaSaida.orderBy("criadoEm").toArray();
    },
    async remover(localId) {
      return db.filaSaida.delete(localId);
    },
    async contar() {
      return db.filaSaida.count();
    },
  };

  window.DBLocal = {
    db,
    getSessao,
    setSessao,
    limparDadosDoPapel,
    FamiliasCompleto,
    FamiliasOperacional,
    Ciclos,
    Estoque,
    Entregas,
    FilaSaida,
  };
})();
