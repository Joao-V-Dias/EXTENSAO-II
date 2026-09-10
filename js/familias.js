// Cadastro de famílias — tela exclusiva do Administrador.
//
// Dado sensível (CPF, renda, dependentes, foto) é guardado localmente
// SEMPRE criptografado (ver cripto.js). Sem o PIN do dispositivo, a tela
// não mostra nem permite gravar dado sensível — só o servidor (com o
// Administrador logado) tem a cópia em texto puro, protegida por RLS.

(function () {
  const { escapeHtml, gerarId, formatarDataBr, formatarMoedaBr } = window.Util;

  async function render(container) {
    if (!window.Cripto.estaDesbloqueado()) {
      const configurado = await window.Cripto.dispositivoConfigurado();
      renderTelaPin(container, configurado);
      return;
    }
    await renderTelaLista(container);
  }

  function renderTelaPin(container, configurado) {
    container.innerHTML = "";
    const div = document.createElement("div");
    div.className = "cartao cartao-pin";
    div.innerHTML = `
      <h2>Proteção do dispositivo</h2>
      <p>Os dados de CPF, renda e dependentes são criptografados neste
      dispositivo. ${
        configurado
          ? "Digite o PIN deste dispositivo para ver e editar os cadastros."
          : "Crie um PIN de proteção (mínimo 4 caracteres) para começar a usar o cadastro de famílias neste dispositivo. Guarde esse PIN — ele não pode ser recuperado."
      }</p>
      <form id="form-pin">
        <label>PIN do dispositivo
          <input type="password" inputmode="numeric" id="campo-pin" required minlength="4" autocomplete="off" />
        </label>
        ${
          configurado
            ? ""
            : `<label>Confirme o PIN
                <input type="password" inputmode="numeric" id="campo-pin-confirma" required minlength="4" autocomplete="off" />
              </label>`
        }
        <button type="submit" class="botao-grande">${configurado ? "Desbloquear" : "Criar PIN"}</button>
        <p id="erro-pin" class="mensagem-erro" hidden></p>
      </form>
    `;
    container.appendChild(div);

    document.getElementById("form-pin").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const pin = document.getElementById("campo-pin").value;
      const erroEl = document.getElementById("erro-pin");
      erroEl.hidden = true;
      try {
        if (configurado) {
          const ok = await window.Cripto.desbloquear(pin);
          if (!ok) throw new Error("PIN incorreto.");
        } else {
          const confirmacao = document.getElementById("campo-pin-confirma").value;
          if (pin !== confirmacao) throw new Error("Os PINs não coincidem.");
          await window.Cripto.configurarPin(pin);
        }
        await render(container);
      } catch (erro) {
        erroEl.textContent = erro.message;
        erroEl.hidden = false;
      }
    });
  }

  async function descriptografarLista(registros) {
    const resultado = [];
    for (const registro of registros) {
      let sensivel = {};
      try {
        sensivel = (await window.Cripto.descriptografarObjeto(registro.sensivelCripto)) || {};
      } catch (erro) {
        sensivel = { erro: true };
      }
      resultado.push({ ...registro, sensivel });
    }
    return resultado;
  }

  async function renderTelaLista(container, edicaoId) {
    const registros = await window.DBLocal.FamiliasCompleto.listar();
    const comSensivel = await descriptografarLista(registros);
    const emEdicao = edicaoId ? comSensivel.find((f) => f.id === edicaoId) : null;

    container.innerHTML = `
      <div class="barra-titulo">
        <h2>Cadastro de famílias</h2>
        <button id="botao-bloquear" class="botao-secundario" title="Bloquear dados sensíveis novamente">🔒 Bloquear</button>
      </div>
      <details class="cartao" id="detalhes-form" ${emEdicao ? "open" : ""}>
        <summary>${emEdicao ? "Editar família" : "+ Nova família"}</summary>
        <form id="form-familia">
          <input type="hidden" id="f-id" value="${emEdicao ? emEdicao.id : ""}" />
          <label>Nome completo
            <input type="text" id="f-nome" required value="${escapeHtml(emEdicao ? emEdicao.nome : "")}" />
          </label>
          <label>CPF
            <input type="text" id="f-cpf" inputmode="numeric" placeholder="somente números" value="${escapeHtml(emEdicao ? emEdicao.sensivel.cpf : "")}" />
          </label>
          <label>Renda familiar (R$)
            <input type="number" step="0.01" min="0" id="f-renda" value="${emEdicao && emEdicao.sensivel.renda != null ? emEdicao.sensivel.renda : ""}" />
          </label>
          <label>Número de dependentes
            <input type="number" step="1" min="0" id="f-dependentes" value="${emEdicao && emEdicao.sensivel.numeroDependentes != null ? emEdicao.sensivel.numeroDependentes : 0}" />
          </label>
          <label>Foto (link opcional — pode deixar em branco)
            <input type="url" id="f-foto" placeholder="https://..." value="${escapeHtml(emEdicao ? emEdicao.sensivel.fotoUrl : "")}" />
          </label>
          <label class="linha-checkbox">
            <input type="checkbox" id="f-consentimento" ${emEdicao && emEdicao.sensivel.consentimento ? "checked" : ""} />
            A família autorizou o uso destes dados para distribuição de cestas e prestação de contas (LGPD)
          </label>
          <label>Finalidade declarada
            <input type="text" id="f-finalidade" value="${escapeHtml(emEdicao ? emEdicao.sensivel.consentimentoFinalidade : "Distribuição de cestas básicas e prestação de contas")}" />
          </label>
          <div class="botoes-form">
            <button type="submit" class="botao-grande">Salvar</button>
            ${emEdicao ? '<button type="button" id="botao-cancelar-edicao" class="botao-secundario">Cancelar</button>' : ""}
          </div>
          <p id="erro-familia" class="mensagem-erro" hidden></p>
        </form>
      </details>

      <div class="lista-familias">
        ${comSensivel
          .map(
            (f) => `
          <div class="cartao linha-familia">
            <div>
              <strong>${escapeHtml(f.nome)}</strong>
              ${!f.sensivel.consentimento ? '<span class="etiqueta etiqueta-alerta">sem consentimento registrado</span>' : ""}
              <div class="detalhe-secundario">
                CPF: ${escapeHtml(f.sensivel.cpf || "—")} · Renda: ${escapeHtml(formatarMoedaBr(f.sensivel.renda))} ·
                Dependentes: ${escapeHtml(f.sensivel.numeroDependentes ?? "—")} · Cadastro: ${formatarDataBr(f.sensivel.dataCadastro)}
              </div>
            </div>
            <div class="botoes-linha">
              <button class="botao-secundario" data-editar="${f.id}">Editar</button>
              <button class="botao-perigo" data-excluir="${f.id}">Excluir dados</button>
            </div>
          </div>`
          )
          .join("") || "<p>Nenhuma família cadastrada ainda.</p>"}
      </div>
    `;

    document.getElementById("botao-bloquear").addEventListener("click", () => {
      window.Cripto.bloquear();
      render(container);
    });

    document.getElementById("form-familia").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const erroEl = document.getElementById("erro-familia");
      erroEl.hidden = true;
      try {
        await salvarFamilia({
          id: document.getElementById("f-id").value || null,
          nome: document.getElementById("f-nome").value.trim(),
          cpf: document.getElementById("f-cpf").value.trim(),
          renda: document.getElementById("f-renda").value || null,
          numeroDependentes: Number(document.getElementById("f-dependentes").value || 0),
          fotoUrl: document.getElementById("f-foto").value.trim() || null,
          consentimento: document.getElementById("f-consentimento").checked,
          consentimentoFinalidade: document.getElementById("f-finalidade").value.trim(),
        });
        await renderTelaLista(container);
      } catch (erro) {
        erroEl.textContent = erro.message;
        erroEl.hidden = false;
      }
    });

    const botaoCancelar = document.getElementById("botao-cancelar-edicao");
    if (botaoCancelar) {
      botaoCancelar.addEventListener("click", () => renderTelaLista(container));
    }

    container.querySelectorAll("[data-editar]").forEach((botao) => {
      botao.addEventListener("click", () => renderTelaLista(container, botao.dataset.editar));
    });

    container.querySelectorAll("[data-excluir]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const familia = comSensivel.find((f) => f.id === botao.dataset.excluir);
        const nomeConfirmacao = familia ? familia.nome : "esta família";
        const confirmado = confirm(
          `Isto vai apagar PERMANENTEMENTE o cadastro e o histórico de entregas de "${nomeConfirmacao}" (direito de exclusão da LGPD). Esta ação não pode ser desfeita. Confirma?`
        );
        if (!confirmado) return;
        await excluirFamilia(botao.dataset.excluir);
        await renderTelaLista(container);
      });
    });
  }

  async function salvarFamilia(dados) {
    if (!dados.nome) throw new Error("Informe o nome da família.");
    const existente = dados.id ? await window.DBLocal.FamiliasCompleto.obter(dados.id) : null;
    const id = dados.id || gerarId();
    const agoraIso = new Date().toISOString();

    let dataCadastroExistente = agoraIso;
    if (existente) {
      try {
        const sensivelAntigo = await window.Cripto.descriptografarObjeto(existente.sensivelCripto);
        if (sensivelAntigo && sensivelAntigo.dataCadastro) dataCadastroExistente = sensivelAntigo.dataCadastro;
      } catch (erro) {
        /* mantém data atual se não conseguir ler o registro antigo */
      }
    }

    const consentimentoData = dados.consentimento ? agoraIso : null;

    const sensivel = {
      cpf: dados.cpf || null,
      renda: dados.renda !== null && dados.renda !== "" ? Number(dados.renda) : null,
      numeroDependentes: dados.numeroDependentes,
      fotoUrl: dados.fotoUrl,
      consentimento: dados.consentimento,
      consentimentoData,
      consentimentoFinalidade: dados.consentimentoFinalidade || null,
      dataCadastro: dataCadastroExistente,
    };

    await window.DBLocal.FamiliasCompleto.upsert({
      id,
      nome: dados.nome,
      ativa: true,
      sensivelCripto: await window.Cripto.criptografarObjeto(sensivel),
    });
    // Mantém a view operacional local em dia mesmo sem ter sincronizado
    // com o servidor ainda — é dela que a tela de Entregas lê a lista de
    // famílias (nunca dado sensível, só id/nome/ativa).
    await window.DBLocal.FamiliasOperacional.upsert({ id, nome: dados.nome, ativa: true });

    await window.Sync.enfileirar("familias", dados.id ? "update" : "insert", {
      id,
      nome: dados.nome,
      cpf: sensivel.cpf,
      renda: sensivel.renda,
      numero_dependentes: sensivel.numeroDependentes,
      foto_url: sensivel.fotoUrl,
      consentimento: sensivel.consentimento,
      consentimento_data: sensivel.consentimentoData,
      consentimento_finalidade: sensivel.consentimentoFinalidade,
      ativa: true,
      data_cadastro: sensivel.dataCadastro,
    });
  }

  async function excluirFamilia(id) {
    await window.DBLocal.FamiliasCompleto.remover(id);
    await window.DBLocal.FamiliasOperacional.remover(id);
    await window.Sync.enfileirar("familias", "excluir_lgpd", { id });
  }

  window.TelaFamilias = { render };
})();
