// Autenticação e papéis (Administrador | Estoquista | Voluntário).
//
// Login por papel via Supabase Auth. Como o sistema precisa operar sem
// rede (sede sem Wi-Fi, 3G/4G instável), guardamos localmente um HASH da
// senha (nunca a senha em texto puro) do último login bem-sucedido de cada
// usuário neste dispositivo, para permitir novo login OFFLINE depois da
// primeira vez online. O papel (RLS) continua sendo decidido pelo servidor
// sempre que há rede — o cache local é só para abrir o app sem sinal.

(function () {
  const CHAVE_USUARIO_ATUAL = "usuarioAtual";

  let supabaseClient = null;
  const config = window.PRATO_CHEIO_CONFIG || {};
  if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase) {
    supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }

  const estado = {
    usuario: null, // { id, nome, email, papel }
    modoOffline: false,
  };

  async function sha256Hex(texto) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function chaveCredencial(email) {
    return "cred_" + email.trim().toLowerCase();
  }

  function chavePerfil(email) {
    return "perfil_" + email.trim().toLowerCase();
  }

  async function salvarLoginLocal(email, senha, perfil) {
    const hash = await sha256Hex(email.trim().toLowerCase() + "|" + senha);
    await window.DBLocal.setSessao(chaveCredencial(email), hash);
    await window.DBLocal.setSessao(chavePerfil(email), perfil);
  }

  async function tentarLoginOffline(email, senha) {
    const hashSalvo = await window.DBLocal.getSessao(chaveCredencial(email));
    if (!hashSalvo) {
      throw new Error(
        "Sem conexão e nenhum login anterior salvo para este usuário neste dispositivo."
      );
    }
    const hashDigitado = await sha256Hex(email.trim().toLowerCase() + "|" + senha);
    if (hashDigitado !== hashSalvo) {
      throw new Error("E-mail ou senha incorretos.");
    }
    const perfil = await window.DBLocal.getSessao(chavePerfil(email));
    return perfil;
  }

  async function buscarPerfil(id) {
    const { data, error } = await supabaseClient
      .from("usuarios")
      .select("id, nome, papel, ativo")
      .eq("id", id)
      .single();
    if (error) throw error;
    if (!data.ativo) throw new Error("Usuário desativado. Fale com o administrador.");
    return data;
  }

  async function login(email, senha) {
    if (!email || !senha) throw new Error("Informe e-mail e senha.");

    if (supabaseClient && navigator.onLine) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        });
        if (error) throw error;

        const perfil = await buscarPerfil(data.user.id);
        const usuario = { id: perfil.id, nome: perfil.nome, email: email.trim(), papel: perfil.papel };

        await salvarLoginLocal(email, senha, usuario);
        await window.DBLocal.setSessao(CHAVE_USUARIO_ATUAL, usuario);

        estado.usuario = usuario;
        estado.modoOffline = false;
        return usuario;
      } catch (erroOnline) {
        // Se o erro foi de rede (não de credencial), tenta o caminho offline.
        const pareceErroDeRede =
          erroOnline instanceof TypeError || /fetch|network/i.test(erroOnline.message || "");
        if (!pareceErroDeRede) throw erroOnline;
      }
    }

    // Sem rede, ou Supabase não configurado: login offline por hash local.
    const usuario = await tentarLoginOffline(email, senha);
    await window.DBLocal.setSessao(CHAVE_USUARIO_ATUAL, usuario);
    estado.usuario = usuario;
    estado.modoOffline = true;
    return usuario;
  }

  async function restaurarSessao() {
    const usuario = await window.DBLocal.getSessao(CHAVE_USUARIO_ATUAL);
    if (usuario) {
      estado.usuario = usuario;
      estado.modoOffline = !navigator.onLine;
    }
    return usuario || null;
  }

  async function logout() {
    if (supabaseClient && navigator.onLine) {
      try {
        await supabaseClient.auth.signOut();
      } catch (erro) {
        // Sem rede para invalidar sessão remota: segue com o logout local.
      }
    }
    estado.usuario = null;
    await window.DBLocal.setSessao(CHAVE_USUARIO_ATUAL, null);
  }

  function getUsuario() {
    return estado.usuario;
  }

  function getPapel() {
    return estado.usuario ? estado.usuario.papel : null;
  }

  function estaLogado() {
    return !!estado.usuario;
  }

  function podeAcessar(papeisPermitidos) {
    return estaLogado() && papeisPermitidos.includes(estado.usuario.papel);
  }

  window.Auth = {
    supabaseClient,
    login,
    logout,
    restaurarSessao,
    getUsuario,
    getPapel,
    estaLogado,
    podeAcessar,
    get modoOffline() {
      return estado.modoOffline;
    },
  };
})();
