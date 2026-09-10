// Ponto de entrada do app: registra o Service Worker, decide entre tela de
// login e app principal, e roteia por hash entre as telas de cada papel.

(function () {
  const ROTAS = {
    "#/familias": { papeis: ["admin"], tela: () => window.TelaFamilias, rotulo: "Famílias" },
    "#/estoque": { papeis: ["admin", "estoquista"], tela: () => window.TelaEstoque, rotulo: "Estoque" },
    "#/entregas": {
      papeis: ["admin", "estoquista", "voluntario"],
      tela: () => window.TelaEntregas,
      rotulo: "Entregas",
    },
    "#/relatorios": { papeis: ["admin"], tela: () => window.TelaRelatorios, rotulo: "Relatórios" },
  };

  const ROTA_PADRAO_POR_PAPEL = {
    admin: "#/entregas",
    estoquista: "#/estoque",
    voluntario: "#/entregas",
  };

  function registrarServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch((erro) => {
          console.warn("Prato Cheio: não foi possível registrar o service worker.", erro);
        });
      });
    }
  }

  function renderNav() {
    const papel = window.Auth.getPapel();
    const nav = document.getElementById("nav-principal");
    nav.innerHTML = Object.entries(ROTAS)
      .filter(([, rota]) => rota.papeis.includes(papel))
      .map(
        ([hash, rota]) =>
          `<a href="${hash}" class="link-nav ${location.hash === hash ? "link-nav-ativo" : ""}">${rota.rotulo}</a>`
      )
      .join("");
  }

  function renderInfoUsuario() {
    const usuario = window.Auth.getUsuario();
    if (!usuario) return;
    const rotulosPapel = { admin: "Administrador", estoquista: "Estoquista", voluntario: "Voluntário" };
    document.getElementById("info-usuario").textContent = `${usuario.nome} · ${rotulosPapel[usuario.papel] || usuario.papel}`;
  }

  async function renderIndicadorRede() {
    const el = document.getElementById("indicador-rede");
    const pendentes = await window.Sync.contarPendentes();
    const online = navigator.onLine;
    el.className = "indicador-rede " + (online ? "indicador-online" : "indicador-offline");
    el.textContent = online
      ? pendentes > 0
        ? `Online — sincronizando ${pendentes} item(ns)...`
        : "Online — tudo sincronizado"
      : `Offline — ${pendentes} item(ns) aguardando conexão`;
  }

  async function rotear() {
    const papel = window.Auth.getPapel();
    let hash = location.hash;

    if (!hash || !ROTAS[hash]) {
      hash = ROTA_PADRAO_POR_PAPEL[papel] || "#/entregas";
      history.replaceState(null, "", hash);
    }

    const rota = ROTAS[hash];
    const conteudo = document.getElementById("conteudo");

    if (!rota || !rota.papeis.includes(papel)) {
      conteudo.innerHTML = "<p>Você não tem permissão para acessar esta tela.</p>";
      return;
    }

    renderNav();
    const tela = rota.tela();
    try {
      await tela.render(conteudo);
    } catch (erro) {
      console.error("Prato Cheio: erro ao renderizar tela.", erro);
      conteudo.innerHTML = `<p class="mensagem-erro">Ocorreu um erro ao carregar esta tela. Tente novamente.</p>`;
    }
  }

  function mostrarApp() {
    document.getElementById("tela-login").hidden = true;
    document.getElementById("app").hidden = false;
    renderInfoUsuario();
    renderIndicadorRede();
    rotear();
  }

  function mostrarLogin() {
    document.getElementById("app").hidden = true;
    document.getElementById("tela-login").hidden = false;
  }

  function ligarFormularioLogin() {
    document.getElementById("form-login").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const erroEl = document.getElementById("login-erro");
      erroEl.hidden = true;
      try {
        await window.Auth.login(
          document.getElementById("login-email").value,
          document.getElementById("login-senha").value
        );
        mostrarApp();
        window.Sync.processarFila();
      } catch (erro) {
        erroEl.textContent = erro.message || "Não foi possível entrar.";
        erroEl.hidden = false;
      }
    });
  }

  function ligarBotoesCabecalho() {
    document.getElementById("botao-sair").addEventListener("click", async () => {
      await window.Auth.logout();
      window.Cripto.bloquear();
      mostrarLogin();
    });
    document.getElementById("botao-sincronizar").addEventListener("click", () => {
      window.Sync.processarFila();
    });
  }

  async function iniciar() {
    registrarServiceWorker();
    ligarFormularioLogin();
    ligarBotoesCabecalho();

    window.addEventListener("hashchange", rotear);
    window.addEventListener("online", renderIndicadorRede);
    window.addEventListener("offline", renderIndicadorRede);
    window.Sync.aoMudar(renderIndicadorRede);

    const usuario = await window.Auth.restaurarSessao();
    if (usuario) {
      mostrarApp();
    } else {
      mostrarLogin();
    }

    window.Sync.init();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
