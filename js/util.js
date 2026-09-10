// Utilidades pequenas e sem dependência, compartilhadas pelos módulos.
(function () {
  function escapeHtml(texto) {
    if (texto === null || texto === undefined) return "";
    return String(texto)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function gerarId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback simples para navegadores muito antigos sem randomUUID.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function formatarDataBr(isoOuData) {
    if (!isoOuData) return "—";
    const data = new Date(isoOuData);
    if (isNaN(data.getTime())) return "—";
    return data.toLocaleDateString("pt-BR");
  }

  function formatarMoedaBr(valor) {
    if (valor === null || valor === undefined || valor === "") return "—";
    const numero = Number(valor);
    if (isNaN(numero)) return "—";
    return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function diasAte(dataIso) {
    if (!dataIso) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const alvo = new Date(dataIso + "T00:00:00");
    return Math.round((alvo - hoje) / 86400000);
  }

  function baixarCsv(nomeArquivo, linhasCsv) {
    const blob = new Blob(["﻿" + linhasCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function celulaCsv(valor) {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    if (/[",\n;]/.test(texto)) {
      return '"' + texto.replace(/"/g, '""') + '"';
    }
    return texto;
  }

  window.Util = {
    escapeHtml,
    gerarId,
    formatarDataBr,
    formatarMoedaBr,
    diasAte,
    baixarCsv,
    celulaCsv,
  };
})();
