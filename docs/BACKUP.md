# Backup e Restore do Banco de Dados

## Por que fazer backup?

Os dados do sistema (notas fiscais, usuários, alíquotas ISS, endereços de obra) ficam no Postgres. Se o banco for recriado, trocado ou apagado, **tudo é perdido**. Backups regulares protegem contra isso.

---

## Como fazer backup

### Opção 1: Do seu PC (recomendado)

1. Abra um terminal e deixe o túnel rodando:
   ```bash
   fly proxy 15433:5432 -a api-sig-db
   ```

2. Em outro terminal, na pasta do projeto, defina a URL e rode o backup:
   ```powershell
   # Windows PowerShell
   $env:DATABASE_URL = "postgres://postgres:SUA_SENHA@127.0.0.1:15433/postgres?sslmode=disable"
   node scripts/backup_db.js
   ```
   *(Troque SUA_SENHA pela senha do Postgres — veja no dashboard Fly → api-sig-db → Connect)*

3. O arquivo será salvo em `backups/backup_AAAA-MM-DD_HH-mm-ss.json`. **Guarde esse arquivo em local seguro** (OneDrive, HD externo, etc.).

### Opção 2: Dentro do container Fly

```bash
fly ssh console -a api-sig-premcell
node scripts/backup_db.js
exit
```

**Atenção:** o arquivo fica dentro do container e será perdido no próximo deploy. Para guardar, copie para o volume de uploads ou use a Opção 1.

---

## Como restaurar

1. Com o túnel aberto (se estiver restaurando no Fly):
   ```bash
   fly proxy 15433:5432 -a api-sig-db
   ```

2. Simular (só mostra o que seria feito):
   ```bash
   node scripts/restore_db.js backups/backup_2025-02-05_12-30-00.json
   ```

3. Restaurar de verdade:
   ```bash
   node scripts/restore_db.js backups/backup_2025-02-05_12-30-00.json --confirm
   ```

---

## Backups automáticos do Fly Postgres

O Fly.io oferece backups automáticos no plano pago. Verifique em:

- Dashboard Fly → app **api-sig-db** → **Backups**
- Ou: https://fly.io/docs/postgres/managing/backups/

Se estiver no plano gratuito, **faça backups manuais com frequência** (por exemplo, toda semana).

---

## Checklist de proteção

- [ ] Rodar `node scripts/backup_db.js` periodicamente (ex.: toda semana)
- [ ] Guardar o arquivo de backup em local seguro e fora do projeto
- [ ] Antes de criar tabelas em banco novo, rodar `node scripts/verificar_tabelas.js`
- [ ] Se o banco estiver vazio e existir outro (ex.: api_sig_premcell), verificar com `node scripts/listar_bancos_e_tabelas.js` antes de criar tabelas
