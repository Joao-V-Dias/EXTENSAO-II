// Criptografia local (Web Crypto API, nativa — sem dependência externa).
//
// Por que existe: o guia técnico exige que dado sensível em cache no
// dispositivo do Administrador fique criptografado (defesa extra caso o
// PC/celular do admin seja perdido ou acessado por terceiro). Os demais
// papéis (voluntário, estoquista) nunca recebem dado sensível — não
// precisam de criptografia local porque não há o que proteger no cache
// deles (ver db-local.js / familiasOperacional).
//
// Como funciona: o Administrador define um "PIN do dispositivo" (separado
// da senha de login) na primeira vez que usa este PC/celular. Uma chave
// AES-GCM-256 é derivada do PIN via PBKDF2 (150.000 iterações) + um salt
// aleatório guardado localmente (salt não é segredo). A chave derivada
// SÓ existe em memória durante a sessão — nunca é salva em disco. Sem o
// PIN correto, os dados sensíveis salvos localmente não podem ser lidos.

(function () {
  const ITERACOES_PBKDF2 = 150000;
  const CHAVE_SESSAO_SALT = "cripto_salt";
  const CHAVE_SESSAO_VERIFICADOR = "cripto_verificador";
  const TEXTO_VERIFICADOR = "prato-cheio-verificador-ok";

  let chaveAtual = null; // CryptoKey, só em memória

  function bufferParaBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binario = "";
    for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i]);
    return btoa(binario);
  }

  function base64ParaBuffer(base64) {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes.buffer;
  }

  async function derivarChave(pin, saltBuffer) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode(pin),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: ITERACOES_PBKDF2,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function dispositivoConfigurado() {
    const salt = await window.DBLocal.getSessao(CHAVE_SESSAO_SALT);
    return !!salt;
  }

  async function configurarPin(pin) {
    if (!pin || pin.length < 4) {
      throw new Error("O PIN precisa ter pelo menos 4 dígitos/caracteres.");
    }
    const saltBuffer = crypto.getRandomValues(new Uint8Array(16)).buffer;
    chaveAtual = await derivarChave(pin, saltBuffer);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const dados = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      chaveAtual,
      new TextEncoder().encode(TEXTO_VERIFICADOR)
    );

    await window.DBLocal.setSessao(CHAVE_SESSAO_SALT, bufferParaBase64(saltBuffer));
    await window.DBLocal.setSessao(CHAVE_SESSAO_VERIFICADOR, {
      iv: bufferParaBase64(iv),
      dados: bufferParaBase64(dados),
    });
  }

  async function desbloquear(pin) {
    const saltB64 = await window.DBLocal.getSessao(CHAVE_SESSAO_SALT);
    const verificador = await window.DBLocal.getSessao(CHAVE_SESSAO_VERIFICADOR);
    if (!saltB64 || !verificador) {
      throw new Error("Este dispositivo ainda não tem um PIN configurado.");
    }
    const candidata = await derivarChave(pin, base64ParaBuffer(saltB64));
    try {
      const textoPlano = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ParaBuffer(verificador.iv) },
        candidata,
        base64ParaBuffer(verificador.dados)
      );
      const texto = new TextDecoder().decode(textoPlano);
      if (texto !== TEXTO_VERIFICADOR) return false;
    } catch (erro) {
      return false; // PIN incorreto: a tag de autenticação do AES-GCM falha
    }
    chaveAtual = candidata;
    return true;
  }

  function bloquear() {
    chaveAtual = null;
  }

  function estaDesbloqueado() {
    return !!chaveAtual;
  }

  async function criptografarObjeto(objeto) {
    if (!chaveAtual) throw new Error("Dispositivo bloqueado: informe o PIN antes de gravar dados sensíveis.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const dados = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      chaveAtual,
      new TextEncoder().encode(JSON.stringify(objeto))
    );
    return { iv: bufferParaBase64(iv), dados: bufferParaBase64(dados) };
  }

  async function descriptografarObjeto(blob) {
    if (!chaveAtual) throw new Error("Dispositivo bloqueado: informe o PIN para ver os dados sensíveis.");
    if (!blob) return null;
    const textoPlano = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ParaBuffer(blob.iv) },
      chaveAtual,
      base64ParaBuffer(blob.dados)
    );
    return JSON.parse(new TextDecoder().decode(textoPlano));
  }

  window.Cripto = {
    dispositivoConfigurado,
    configurarPin,
    desbloquear,
    bloquear,
    estaDesbloqueado,
    criptografarObjeto,
    descriptografarObjeto,
  };
})();
