# Deploy no Fly.io - API SIG Premcell

## Pré-requisitos

1. Conta no Fly.io: https://fly.io/app/sign-up
2. **CLI do Fly instalado** (obrigatório):
   ```powershell
   # Windows (PowerShell como Administrador)
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```
   Depois, feche e abra o terminal (ou reinicie o PATH). Teste: `fly version`.

   Mac/Linux:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

---

## Passos para Deploy (ordem recomendada)

### 1. Login no Fly
```bash
fly auth login
```

### 2. Criar o app (só na primeira vez)
```bash
fly apps create api-sig-premcell
```
Se o nome já existir, escolha outro e atualize o `app = "..."` no `fly.toml`.

### 3. Criar o volume persistente (só na primeira vez)
O app usa `primary_region = "gru"` (São Paulo). O volume tem que ser na mesma região:
```bash
fly volumes create uploads_data --size 1 --region gru
```

### 4. Criar o PostgreSQL (só na primeira vez)
```bash
fly postgres create --name api-sig-db --region gru --vm-size shared-cpu-1x --volume-size 1
```

### 5. Anexar o banco ao app
```bash
fly postgres attach api-sig-db --app api-sig-premcell
```
Isso define a variável `DATABASE_URL` no app.

### 6. Definir secrets (token Focus NFe)
```bash
fly secrets set FOCUS_TOKEN="seu_token_focus_aqui"
fly secrets set WEBHOOK_RECEBIDAS_TOKEN="um_token_secreto_qualquer"
```
O `WEBHOOK_RECEBIDAS_TOKEN` protege a rota `POST /webhook/focus/nfse-recebida` — configure o mesmo valor
como query string na URL do webhook cadastrada no painel da Focus NFe (evento `nfsen_recebida`):
`https://api-sig-premcell.fly.dev/webhook/focus/nfse-recebida?token=um_token_secreto_qualquer`.
Depois de anexar o banco, rode `node scripts/criar_tabela_notas_recebidas.js` (ou `npm run criar-tabelas`)
para criar a tabela `notas_recebidas`.

O mesmo `WEBHOOK_RECEBIDAS_TOKEN` protege `POST /webhook/focus/nfe-recebida` (evento `nfe_recebida`,
NF-e modelo 55 recebidas): `https://api-sig-premcell.fly.dev/webhook/focus/nfe-recebida?token=um_token_secreto_qualquer`.
Rode `node scripts/criar_tabela_nfe_recebidas.js` (ou `npm run criar-tabelas`) para criar a tabela `nfe_recebidas`.

### 7. Deploy
Na pasta do projeto (onde está o `fly.toml`):
```bash
cd c:\Users\linha\OneDrive\Desktop\API_SIG
fly deploy
```

### 8. Backup do banco (proteção contra perda de dados)

**Faça backup regularmente.** Os dados não voltam se o banco for perdido.

```bash
# Terminal 1: túnel
fly proxy 15433:5432 -a api-sig-db

# Terminal 2: backup (troque SUA_SENHA)
$env:DATABASE_URL = "postgres://postgres:SUA_SENHA@127.0.0.1:15433/postgres?sslmode=disable"
node scripts/backup_db.js
```

O arquivo vai para `backups/`. Guarde-o em local seguro. Ver `docs/BACKUP.md` para detalhes.

---

### 9. Configurar o banco de dados (após o primeiro deploy)

**9.1 – Criar o Postgres (se ainda não criou)**  
Na mesma região do app (`gru`):
```bash
fly postgres create --name api-sig-db --region gru --vm-size shared-cpu-1x --volume-size 1
```

**9.2 – Anexar o Postgres ao app**  
Isso define a variável `DATABASE_URL` no app:
```bash
fly postgres attach api-sig-db --app api-sig-premcell
```

**8.3 – Criar as tabelas**  
Entrar no container do app e rodar o script que cria todas as tabelas:
```bash
fly ssh console -a api-sig-premcell
```
Dentro do console:
```bash
node scripts/criar_todas_tabelas.js
exit
```

**9.4 – (Opcional) Criar usuário admin para login**  
De novo no console do app:
```bash
fly ssh console -a api-sig-premcell
node scripts/criar_usuario_admin.js
exit
```
(Login: `pedro.ferreira@premcell.com.br` / senha: `adminpf` — altere no script se quiser.)

**Importante:** depois de anexar o Postgres (`fly postgres attach`), faça um novo deploy para o app carregar a `DATABASE_URL`:
```bash
fly deploy
```
Depois rode os passos 8.3 e 8.4.

### 10. Migrar dados do banco local para o Fly (alíquotas ISS e endereços obra)

**Não migra usuários** — use o script `criar_usuario_admin.js` no Fly para isso.

**9.1 – Obter a connection string do Postgres no Fly**

- **Opção A – Tunnel (recomendado)**  
  1. Em um terminal, deixe rodando: `fly proxy 15433:5432 -a api-sig-db` (local:remota — Postgres no Fly escuta na 5432).  
  2. No dashboard Fly.io → app **api-sig-db** → aba **Connect** (ou **Connection string**). Copie usuário e senha.  
  3. Defina (PowerShell, na pasta do projeto):
  ```powershell
  $env:FLY_DATABASE_URL = "postgres://USUARIO:SENHA@127.0.0.1:15433/postgres"
  ```
  Troque `USUARIO` e `SENHA` pelos valores do dashboard.

- **Opção B – Connection string externa**  
  Se o dashboard mostrar uma URL pública para o Postgres, use-a em `FLY_DATABASE_URL`.

**10.2 – Rodar a migração**

Com o `.env` local configurado (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) e, se usou tunnel, com `fly proxy 15433 -a api-sig-db` rodando em outro terminal:

```powershell
cd c:\Users\linha\OneDrive\Desktop\API_SIG
node scripts/migrar_dados_para_fly.js
```

O script copia apenas **municipio_aliquota_iss** e **site_endereco_obra**; **usuarios** não é alterado.

---

## Problema: "Só consigo acessar o banco nesta máquina"

### O que acontece

- **App no Fly** usa o Postgres do Fly (`DATABASE_URL` definida pelo `fly postgres attach`). O deploy **não** usa o PostgreSQL da sua PC.
- O **Postgres do Fly não tem URL pública**. Para acessá-lo (DBeaver, pgAdmin, script, etc.) você precisa de um **tunnel** na máquina de onde está conectando.

### Acesso ao banco do Fly a partir de outra máquina

1. **Na máquina de onde quer acessar** (a “outra”):
   - Instale o Fly CLI e faça login: `fly auth login`.
   - Abra o tunnel (deixe o terminal aberto):
     ```bash
     fly proxy 15433:5432 -a api-sig-db
     ```
   - Conecte no cliente (DBeaver, pgAdmin, etc.) em:
     - Host: `127.0.0.1`
     - Porta: `15433`
     - Usuário/senha: os do app **api-sig-db** no dashboard Fly.io (Connect / Connection string).

2. **Cada PC** de onde você quiser acessar o banco precisa rodar o `fly proxy` **nesse próprio PC**. Não dá para usar o tunnel aberto em outro computador.

### Se o app no Fly parou de conectar no banco após o deploy

- Não defina `DATABASE_URL` manualmente com IP da sua casa ou da empresa (ex.: `postgres://...@192.168.x.x:5432/...`). O app no Fly não alcança sua rede local.
- Use **só** o banco do Fly:
  1. Anexar de novo: `fly postgres attach api-sig-db --app api-sig-premcell`
  2. Fazer deploy: `fly deploy`
- Confira no dashboard Fly.io → app **api-sig-premcell** → **Secrets**: não deve existir `DATABASE_URL` definida à mão; a URL vem do `attach`. Se existir, remova: `fly secrets unset DATABASE_URL` (e depois `fly deploy` se precisar).

### Resumo

| Onde você está        | Como acessar o banco do Fly                          |
|-----------------------|------------------------------------------------------|
| Nesta máquina (PC atual) | `fly proxy 15433:5432 -a api-sig-db` → conectar em `127.0.0.1:15433` |
| Outra máquina         | Instalar Fly CLI, login, rodar o mesmo `fly proxy` **nessa** máquina e conectar em `127.0.0.1:15433` |
| App no Fly (produção) | Usa sozinho a `DATABASE_URL` do `fly postgres attach`; não usar IP da sua rede. |

---

## Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `fly status` | Ver status do app |
| `fly logs` | Ver logs em tempo real |
| `fly ssh console` | Acessar terminal do container |
| `fly postgres connect -a api-sig-db` | Conectar no banco |
| `fly deploy` | Fazer novo deploy |
| `fly open` | Abrir o app no navegador |

---

## URLs após deploy

- **API:** `https://api-sig-premcell.fly.dev`
- **Painel:** `https://api-sig-premcell.fly.dev/painel.html`
- **Login:** `https://api-sig-premcell.fly.dev/login.html`

---

## Estrutura criada

```
API_SIG/
├── Dockerfile          # Imagem Docker para deploy
├── fly.toml            # Configuração do Fly.io
├── .dockerignore       # Arquivos ignorados no build
└── db.js               # Atualizado para suportar DATABASE_URL
```

---

## Custos (plano gratuito)

- **App:** 3 VMs shared-cpu-1x grátis
- **Postgres:** 1 instância grátis (1GB)
- **Volume:** 3GB grátis (usamos 1GB)
- **Bandwidth:** 100GB/mês grátis

Para mais detalhes: https://fly.io/docs/about/pricing/
