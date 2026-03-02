// /js/login.js

const API_BASE = (typeof window !== "undefined" && window.location && /^https?:\/\//.test(window.location.origin)) ? window.location.origin : "http://localhost:3000";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const senhaInput = document.getElementById("senha");
  const errorBox = document.getElementById("login-error");

  if (!form) {
    console.error("Formulário de login não encontrado");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    hideError();

    const email = emailInput.value.trim();
    const senha = senhaInput.value;

    if (!email || !senha) {
      showError("Preencha e-mail e senha.");
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          senha: senha
        })
      });

      let data;
      try {
        data = await resp.json();
      } catch {
        throw new Error("Resposta inválida do servidor");
      }

      if (!resp.ok) {
        showError(data?.erro || "Usuário ou senha inválidos.");
        return;
      }

      // 🔐 Login OK
      console.log("Login realizado com sucesso:", data);

      // Salva token e usuário
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
      }

      if (data.usuario) {
        localStorage.setItem("usuario_logado", JSON.stringify(data.usuario));
      }

      // Redireciona para o painel (mesmo servidor)
      window.location.href = "/painel.html";

    } catch (err) {
      console.error("Erro na requisição de login:", err);
      showError("Erro ao tentar fazer login. Verifique o servidor.");
    }
  });

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  function hideError() {
    if (!errorBox) return;
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }
});
