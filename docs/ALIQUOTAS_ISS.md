# Alíquotas de ISS por município

Não existe **uma única API pública** que devolva alíquota de ISS para qualquer município do Brasil. O projeto mantém um **banco próprio** de alíquotas e pede cadastro quando faltar.

## Ordem de consulta no projeto

1. **Banco de dados** – Tabela `municipio_aliquota_iss` (PostgreSQL).  
   - Criar uma vez: `npm run criar-tabela-aliquotas`  
   - É preenchida quando você cadastra na transformação (municípios sem alíquota) ou quando emite NF (alíquota usada na emissão é salva).

2. **Arquivo local** – `data/aliquotas_municipios.json` (fallback).  
   - Formato: `{ "3550308": "5", "3304557": "2" }` (código IBGE 7 dígitos → alíquota em %).

3. **API oficial (Sistema Nacional NFSe)**  
   - Base: `https://adn.nfse.gov.br/parametrizacao`  
   - Só atende municípios aderentes; na prática muitas chamadas falham.

## Outras fontes (sem API pública)

- **Cenofisco** – tabela de alíquotas no site, mas exige **login** (acesso pago).  
- **Cada prefeitura** – publica em PDF/tabela no próprio portal; não há base única consolidada.  
- **Focus NFe** – usa a mesma API do NFSe Nacional para emissão; não expõe endpoint próprio de “consulta de alíquota”.

## Como funciona

1. **Criar a tabela (uma vez):**  
   `npm run criar-tabela-aliquotas`

2. **Ao transformar a planilha do cliente:**  
   `npm run transformar-planilha -- planilha_cliente.xlsm saida.xlsx`  
   Se algum município não tiver alíquota no banco, o script **pede no terminal** (ex.: `3550308 / São Paulo / SP — alíquota ISS (%): `). Você informa o valor (ex.: 5), o sistema salva na tabela e segue. Na próxima vez esse município já estará cadastrado.

3. **Ao emitir NFs:**  
   Quando você envia a planilha tratada para emitir (upload/emitir), cada nota emitida com sucesso **grava** no banco o par (código do município do serviço + alíquota usada). Assim o banco vai crescendo com os municípios que você realmente usa.
