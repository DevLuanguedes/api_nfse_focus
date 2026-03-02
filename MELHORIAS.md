# Análise do Projeto API SIG – Melhorias Sugeridas

Resumo da análise do projeto **API SIG** (API de Notas Fiscais de Serviço com integração Focus NFe). Abaixo estão as melhorias já aplicadas e as recomendações para próximos passos.

---

## Já corrigido nesta análise

1. **db.js** – Removidos `console.log` que expunham dados de conexão (DB_HOST, DB_USER, tamanho da senha etc.). Esses logs eram um risco de segurança e poluição em produção.
2. **server.js** – Removido o `express.json()` duplicado.
3. **package.json** – Campo `main` alterado de `index.js` para `server.js` (entrada real da aplicação).
4. **.gitignore** – Criado para ignorar `node_modules/`, `.env`, arquivos em `uploads/`, logs e pastas de IDE, evitando commit de credenciais e arquivos desnecessários.

---

## 1. Segurança

### 1.1 Autenticação e autorização

- **Problema:** As rotas `/api/notas`, `/api/dashboard`, `/api/upload`, `/api/debug` estão **sem autenticação**. Qualquer pessoa com acesso à API pode listar notas, emitir NF e ver dados do dashboard.
- **Recomendação:**  
  - Implementar **JWT** (ou sessão) após o login em `/api/auth/login`.  
  - Criar um **middleware de autenticação** (ex.: `middleware/auth.js`) que verifica o token nas rotas protegidas.  
  - Aplicar esse middleware em todas as rotas sensíveis (notas, dashboard, upload, debug).  
  - Opcional: middleware de autorização por `role` (ex.: apenas `admin` em `/api/debug`).

### 1.2 Webhook Focus

- **Problema:** A rota `POST /webhook` aceita qualquer requisição e atualiza `notas_fiscais` pelo `ref`. Não há validação de origem ou assinatura.
- **Recomendação:**  
  - Verificar se a documentação da Focus NFe oferece **token/secret** ou **assinatura** no webhook.  
  - Validar esse token ou assinatura antes de executar o `UPDATE`.  
  - Rejeitar com 401/403 se a validação falhar.

### 1.3 Dados sensíveis

- **config/prestador.js** – CNPJ, endereço, telefone e e-mail estão em código.  
  - Melhor: carregar de **variáveis de ambiente** (ex.: `process.env.CNPJ_PRESTADOR`) ou de tabela de configuração no banco.
- **scripts/criar_usuario_admin.js** – Senha fixa `adminpf` no código.  
  - Melhor: receber senha por **argumento** ou **prompt** (e nunca commitar senha no repositório).

### 1.4 Respostas de erro

- Em vários `catch` a API devolve `err.message` ou detalhes do banco. Em produção isso pode expor informações internas.
- **Recomendação:** Em produção, retornar mensagens genéricas (ex.: “Erro interno”) e registrar o erro completo em log (arquivo ou serviço de log).

---

## 2. Estrutura e organização

### 2.1 Nome da pasta

- **controlles** está com typo; o padrão em inglês é **controllers**.
- **Recomendação:** Renomear para `controllers` e ajustar todos os `require` que apontam para essa pasta.

### 2.2 Uso do controller

- **controlles/emissaoController.js** existe mas **não é usado** em nenhuma rota. As rotas em `notas.js` e `upload.js` usam serviços/utils diretamente.
- **Recomendação:**  
  - Ou passar a usar o controller (rotas → controller → service), mantendo rotas finas;  
  - Ou remover o controller se a decisão for manter a lógica nas rotas/services.

### 2.3 Tamanho do arquivo de upload

- **routes/upload.js** tem centenas de linhas (payload NFSe, helpers, emissão, status).
- **Recomendação:**  
  - Extrair a montagem do payload para um **service** (ex.: `services/nfsePayload.js` ou `services/focusNfse.js`).  
  - Manter em `upload.js` apenas roteamento, validação de arquivo e chamada ao service. Isso melhora testes e leitura.

---

## 3. Configuração e ambiente

### 3.1 Variáveis obrigatórias

- Não há validação no startup (ex.: `server.js` ou um `config/validateEnv.js`) garantindo que `DB_*`, `FOCUS_TOKEN`, etc. existam.
- **Recomendação:** No início da aplicação, checar as variáveis necessárias e dar **falha rápida** com mensagem clara (ex.: “FOCUS_TOKEN não definido”) em vez de falhar no meio de uma requisição.

### 3.2 Debug

- **routes/debug.js** usa caminho fixo `uploads/teste_nfse.xlsx`. Se o arquivo não existir, a rota quebra.
- **Recomendação:**  
  - Garantir que a rota de debug só exista em desenvolvimento (ex.: `if (process.env.NODE_ENV === 'development')`) ou proteger com auth + role admin.  
  - Tratar arquivo inexistente (ex.: retornar 404 ou mensagem objetiva em vez de 500 genérico).

---

## 4. Banco de dados

### 4.1 Pool e encerramento

- **db.js** exporta apenas `query`. Não há função para **encerrar o pool** (ex.: `pool.end()`).
- **Recomendação:** Exportar também algo como `close: () => pool.end()` e chamar em um handler de **graceful shutdown** (ex.: ao receber SIGTERM), para não deixar conexões abertas.

### 4.2 Migrações

- Não foi encontrado sistema de **migrações** (ex.: node-pg-migrate, knex, sequelize).
- **Recomendação:** Introduzir migrações versionadas para criar/alterar tabelas (`usuarios`, `notas_fiscais`, etc.) de forma reproduzível em todos os ambientes.

---

## 5. Boas práticas gerais

### 5.1 Rate limiting

- Não há limite de requisições por IP/usuário. Login, upload e webhook ficam expostos a abuso (força bruta, DDoS).
- **Recomendação:** Usar **express-rate-limit** (ou similar) nas rotas `/api/auth/login`, `/api/upload` e, se público, no `/webhook`.

### 5.2 Validação de entrada

- Em várias rotas o body é usado sem validação estruturada (ex.: Joi, express-validator, Zod).
- **Recomendação:** Validar corpo e parâmetros (tipos, obrigatoriedade, formato de e-mail, ref etc.) e retornar 400 com mensagens claras quando inválido.

### 5.3 Documentação da API

- Não há documentação explícita dos endpoints (Swagger/OpenAPI, Postman, etc.).
- **Recomendação:** Adicionar um **Swagger** (ou similar) com rotas, body, respostas e códigos de erro, ou ao menos um README com exemplos de request/response para cada rota principal.

### 5.4 README

- Falta um **README.md** na raiz com: como rodar (node, npm scripts), variáveis de ambiente necessárias, como rodar migrações e criar o usuário admin.
- **Recomendação:** Criar README com “Instalação”, “Configuração (.env)”, “Scripts” e “API (resumo ou link para doc)”.

---

## 6. Frontend (“Sistema de Gestão - Premcell”)

- A pasta tem **espaço no nome**, o que pode causar problemas em scripts ou em alguns sistemas.
- **Recomendação:** Considerar renomear para algo como `frontend` ou `sistema-gestao-premcell` e atualizar referências (links, builds, etc.).

---

## 7. Resumo prioritário

| Prioridade | Item |
|-----------|------|
| Alta      | Proteger rotas com autenticação (JWT + middleware). |
| Alta      | Validar webhook da Focus (token/assinatura). |
| Alta      | Não expor credenciais (remover logs já feito; mover prestador e senha do admin para env/args). |
| Média     | Extrair lógica de payload de `upload.js` para service; usar ou remover `emissaoController`. |
| Média     | Validar env no startup; rate limit em login e upload. |
| Média     | .gitignore (já criado); README e documentação básica da API. |
| Baixa     | Renomear `controlles` → `controllers`; migrações; graceful shutdown do pool. |

Se quiser, posso ajudar a implementar algum desses itens passo a passo (por exemplo: middleware de auth com JWT ou validação do webhook).
