// /js/upload.js
(function() {
  var API_BASE = (typeof window !== "undefined" && window.location && /^https?:\/\//.test(window.location.origin)) ? window.location.origin : "http://localhost:3000";

  function extrairMensagemErro(r) {
    var msg = "";
    var erro = r && r.erro;
    if (typeof erro === "string") msg = erro;
    else if (erro && erro.mensagem) msg = erro.mensagem;
    else if (erro && erro.message) msg = erro.message;
    else if (erro && erro.erro) msg = typeof erro.erro === "string" ? erro.erro : JSON.stringify(erro.erro);
    else if (erro && erro.detalhes && Array.isArray(erro.detalhes)) msg = erro.detalhes.map(function(d) { return d.mensagem || d.msg || d; }).join("; ");
    else if (erro) msg = JSON.stringify(erro).slice(0, 200);
    else if (r && r.mensagem) msg = r.mensagem;
    if (msg && r && r.linha_planilha) return "Linha " + r.linha_planilha + ": " + msg;
    return msg;
  }

  function atualizarTabelaEmitir(resultados, tbody, resumo) {
    if (!tbody) return;
    var total = resultados.length;
    var comNumero = resultados.filter(function(r) { return r.numero_nf != null && String(r.numero_nf).trim() !== ""; }).length;
    var erros = resultados.filter(function(r) { return r.status === "erro"; }).length;
    tbody.innerHTML = "";
    resultados.forEach(function(r) {
      var tr = document.createElement("tr");
      var numNf = r.numero_nf != null && String(r.numero_nf).trim() !== "" ? r.numero_nf : "<span class=\"aguardando-nf\"><i class=\"fa-solid fa-spinner fa-spin\"></i> aguardando</span>";
      var detalheErro = r.status === "erro" ? extrairMensagemErro(r) : "";
      tr.innerHTML = "<td>" + (r.ref || "-") + "</td><td>" + (r.status || "-") + "</td><td>" + numNf + "</td><td>" + (r.codigo_verificacao != null ? r.codigo_verificacao : "-") + "</td><td class=\"erro-detalhe\">" + (detalheErro ? ("<span title=\"" + detalheErro.replace(/"/g, "&quot;") + "\">" + detalheErro + "</span>") : "-") + "</td>";
      tbody.appendChild(tr);
    });
    if (resumo) {
      resumo.textContent = "Total: " + total + " | Com número NF: " + comNumero + " | Erros: " + erros;
    }
    return { total: total, comNumero: comNumero, erros: erros };
  }

  document.addEventListener("click", async (e) => {
    if (e.target.id !== "btnUpload") return;

    const btn = document.getElementById("btnUpload");
    const fileInput = document.getElementById("fileUpload");

    let arquivo = null;
    if (window.__emitPlanilhaBlob instanceof Blob) {
      arquivo = new File(
        [window.__emitPlanilhaBlob],
        "emissao.xlsx",
        { type: window.__emitPlanilhaBlob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
    } else if (fileInput && fileInput.files.length) {
      arquivo = fileInput.files[0];
    }

    if (!arquivo) {
      alert("Complete a Etapa 1 primeiro para transformar a planilha do cliente.");
      return;
    }

    const formData = new FormData();
    formData.append("arquivo", arquivo);

    var divResultado = document.getElementById("emitirResultado");
    var tbody = document.getElementById("tbodyEmitirResultado");
    var resumo = document.getElementById("emitirResumo");

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> Emitindo notas...";
      }

      var resp = await apiFetch(API_BASE + "/api/upload/emitir", { method: "POST", body: formData });
      var data = await resp.json();

      if (!data || data.sucesso !== true) {
        alert("Erro no processamento:\n" + (data?.erro || "Erro desconhecido"));
        return;
      }

      var total = Number(data.total_linhas || 0);
      var resultados = Array.isArray(data.resultados) ? data.resultados : [];

      var refsSemNumero = resultados
        .filter(function(r) { return r.status !== "erro" && (!r.numero_nf || String(r.numero_nf).trim() === ""); })
        .map(function(r) { return r.ref; })
        .filter(Boolean);

      if (divResultado && tbody) {
        atualizarTabelaEmitir(resultados, tbody, resumo);
        divResultado.style.display = "block";

        if (refsSemNumero.length > 0) {
          var barraDiv = document.createElement("div");
          barraDiv.className = "emitir-loading-bar";
          barraDiv.innerHTML = "<div class=\"emitir-loading-text\"><i class=\"fa-solid fa-spinner fa-spin\"></i> Aguardando autorização da Focus... Verificando números da NF automaticamente</div><div class=\"emitir-progress-bar\"><div class=\"emitir-progress-fill\" style=\"width:0%\"></div></div>";
          var progressFill = barraDiv.querySelector(".emitir-progress-fill");
          var insertBefore = divResultado.querySelector(".table-container");
          if (insertBefore) divResultado.insertBefore(barraDiv, insertBefore);

          var inicio = Date.now();
          var limiteMs = 3 * 60 * 1000;
          var intervalo = 3000;

          var verificar = function() {
            if (refsSemNumero.length === 0) return;
            if (Date.now() - inicio > limiteMs) {
              barraDiv.innerHTML = "<div class=\"emitir-loading-text text-muted\"><i class=\"fa-solid fa-clock\"></i> Tempo limite atingido. Use \"Sincronizar com Focus\" em Consultar Notas para atualizar.</div>";
              clearInterval(idVerificar);
              return;
            }
            apiFetch(API_BASE + "/api/upload/status-refs?refs=" + encodeURIComponent(refsSemNumero.join(",")))
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (!res.ok || !res.resultados) return;
                var mapa = {};
                res.resultados.forEach(function(item) {
                  mapa[item.ref] = item;
                });
                resultados = resultados.map(function(r) {
                  var atual = mapa[r.ref];
                  if (atual && atual.numero_nf != null && String(atual.numero_nf).trim() !== "") {
                    refsSemNumero = refsSemNumero.filter(function(ref) { return ref !== r.ref; });
                    return { ref: r.ref, status: atual.status, numero_nf: atual.numero_nf, codigo_verificacao: atual.codigo_verificacao };
                  }
                  return r;
                });
                atualizarTabelaEmitir(resultados, tbody, resumo);
                var pct = Math.min(100, Math.round((1 - refsSemNumero.length / (refsSemNumero.length + resultados.filter(function(x) { return x.numero_nf; }).length)) * 100));
                if (progressFill) progressFill.style.width = (resultados.filter(function(x) { return x.numero_nf; }).length / resultados.length * 100) + "%";
                if (refsSemNumero.length === 0) {
                  if (barraDiv) barraDiv.remove();
                  clearInterval(idVerificar);
                }
              });
          };

          var idVerificar = setInterval(verificar, intervalo);
          verificar();
        }
      }

      var listaErros = resultados.filter(function(r) { return r.status === "erro"; }).map(function(r) {
        var msg = extrairMensagemErro(r);
        return "  • " + (r.ref || "?") + ": " + (msg || "Erro desconhecido");
      });
      var textoErros = listaErros.length > 0 ? "\n\nRefs com erro:\n" + listaErros.join("\n") : "";
      alert(
        "Emissão concluída!\n\n" +
        "Total: " + total + "\n" +
        "Com número NF: " + resultados.filter(function(r) { return r.numero_nf; }).length + "\n" +
        "Erros: " + resultados.filter(function(r) { return r.status === "erro"; }).length +
        textoErros + "\n\n" +
        (refsSemNumero && refsSemNumero.length > 0 ? "Aguardando autorização da Focus. Os números serão atualizados automaticamente." : "Os números da NF estão na tabela abaixo.")
      );

      if (typeof window.__emitGoToStep === "function") {
        try { window.__emitGoToStep(3); } catch (e) {}
      }
    } catch (err) {
      console.error("Erro no upload:", err);
      alert("Erro inesperado ao enviar planilha");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "<i class=\"fa-solid fa-bolt\"></i> Processar Notas";
      }
    }
  });
})();
