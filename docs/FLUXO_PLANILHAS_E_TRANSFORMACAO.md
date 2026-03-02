# Fluxo das planilhas e transformação Portal → Focus

Este documento descreve o fluxo atual (portal → macro VBA → API → Focus) e o que é possível fazer para eliminar a “gambiarra” da macro e fazer a transformação direto na API.

---

## 1. Fluxo atual

```
Portal do cliente          Macro VBA                    API SIG                  Focus NFe
(planilha para faturar)  →  (automacao_NFSE_7.02.xlsm)  →  (upload planilha)  →  (emissão NFSe)
     ap_brCreateInvoice_*.xlsm   transforma e preenche       lê "Automação 7.02"    monta payload
     Sheet1 = formato portal    aba "Automação 7.02"         e envia
```

1. O **portal** disponibiliza uma planilha (ex.: `ap_brCreateInvoice_46415567_20260120220355.xlsm`) com os itens que podem ser faturados.
2. Vocês usam a **macro VBA** (`automacao_NFSE_7.02.xlsm`): colam ou importam os dados do portal na aba **Varredura** (mesmo formato do Sheet1 do portal).
3. A macro usa as abas **ISS_Base**, **Dados** e **Instrução** e gera a aba **Automação 7.02** no formato que a API e a Focus NFe entendem.
4. Vocês exportam ou usam a aba **Automação 7.02** e fazem o **upload** dessa planilha no sistema (API).
5. A **API** lê a primeira aba da planilha, monta o payload por linha (`montarPayloadNfsen` em `routes/upload.js`) e envia para a **Focus NFe**.

---

## 2. Planilha do portal (entrada)

**Arquivo:** `ap_brCreateInvoice_46415567_20260120220355.xlsm`  
**Aba principal:** Sheet1 (linha 1 pode ser texto de instrução; os dados começam na linha 2).

**Colunas principais (formato “portal”):**

| Coluna portal     | Exemplo / uso |
|-------------------|----------------|
| Customer          | Nome do tomador (Razão Social) |
| CNPJ              | CNPJ do tomador |
| PO No.            | Número da PO |
| Release No.       | Release |
| Line No.           | Número da linha |
| Shipment No.      | Shipment |
| Unit Price        | Valor unitário (valor_servico) |
| Currency          | Moeda (BRL) |
| Description       | Descrição do serviço |
| site              | Site (ex.: SITE, SR-SPVL19) |
| ISS_City          | Cidade do serviço (para ISS) |
| ISS_State         | UF do serviço |
| ISS_Base          | Base ISS (pode ser valor ou código) |
| ISS Rate          | Alíquota ISS (%) |
| INSS Base Rate    | Base INSS |
| INSS Rate         | Alíquota INSS (%) |
| Service_Code      | Código do serviço (ex.: 1.07 SUPORTE TECNICO INFO, 1.06 CONSULT…) |
| Iss_Type          | Tipo ISS (ex.: NORMAL, EXEMPT) |
| Invoice Type(Brazil) | Ex.: NFS_E |
| shipToLocationId  | ID local entrega |
| (+ outras colunas de controle) | |

No **portal** normalmente **não vêm** endereço completo do tomador (Logradouro, Número, CEP, Bairro, etc.) nem e-mail – só Customer e CNPJ. Na macro, a aba **Dados** tem um registro por cliente (CNPJ, Nome Fantasia, E-mail, Logradouro, Número, Complemento, Cidade, Bairro, UF, CEP, codigo municipio) e a macro deve fazer o “casamento” por CNPJ para preencher esses campos na **Automação 7.02**.

---

## 3. Planilha após a macro (formato Focus – o que a API espera hoje)

**Arquivo:** saída da macro = aba **Automação 7.02** do `automacao_NFSE_7.02.xlsm` (ou xlsx exportado).

**Colunas que a API usa em `montarPayloadNfsen` (routes/upload.js):**

| Coluna (Automação 7.02)   | Uso no payload Focus |
|---------------------------|------------------------|
| Ref                       | Referência única do envio (obrigatório) |
| Razão Social              | razao_social_tomador |
| Nome Fantasia             | (opcional) |
| Documento_Tomador         | cnpj_tomador ou cpf_tomador |
| E-mail                    | email_tomador |
| Logradouro, Número, Complemento, Bairro, CEP | Endereço tomador |
| Cidade_Tomador            | (complementar) |
| Codigo_Municipio_Tomador  | codigo_municipio_tomador (7 dígitos IBGE) |
| UF_Tomador                | uf_tomador |
| telefone_tomador          | telefone_tomador |
| data_emissao              | data_emissao / data_competencia |
| valor_servico             | valor_servico |
| valor_inss, valor_iss, valor_iss_retido | Tributos |
| item_lista_servico        | codigo_tributacao_nacional_iss (ex.: 070202) |
| descricao_servico         | descricao_servico |
| aliquota_iss              | percentual_aliquota |
| iss_retido                | tipo_retencao_iss (1/2/3) |
| optante_simples_nacional  | codigo_opcao_simples_nacional |
| natureza_operacao         | (número) |
| tributacao_iss            | tributacao_iss (1..4) |
| CEP_Obra, Logradouro_Obra, Numero_Obra, Bairro_Obra, UF_Obra, Codigo_Municipio_Obra | Grupo obra (E0370) quando CTN exige |
| codigo_nbs                | NBS (default 101025210) |
| cnpj_prestador            | (hoje vem da config; pode vir da planilha) |

A **Ref** na planilha da macro é um texto longo que parece concatenar PO, Line e descrição (ex.: `PO: 6211HG3295910-146 Line 2  PO: ...`). A API sanitiza (`sanitizeRef`) e usa como identificador único do envio na Focus.

---

## 4. Lógica da macro `Varredura_Consolidar_Somar_Preencher`

A macro agrupa as linhas da aba **Varredura** por uma **chave** (coluna **BI**) e preenche a aba **Automação 7.02** com **uma linha por grupo**, somando valores e concatenando textos.

### 4.1 Colunas da Varredura (entrada)

| Coluna Excel | Índice (0-based) | Uso na macro |
|--------------|-------------------|--------------|
| **BI**       | 60                | **Chave de agrupamento** – agrupa todas as linhas com o mesmo valor em BI. |
| **R**        | 17                | PO No. – usado para montar o texto `"PO: X Line Y"`. |
| **T**        | 19                | Line No. – usado no mesmo texto. |
| **BH**       | 59                | Location – texto no formato `BR_UF_MUNICIPIO_TAX` (ex.: BR_SP_SAO PAULO_TAX). Daqui saem UF e Município. |
| **AL**       | 37                | LC Code / Service_Code – texto com "7.02" ou "7.03" → vira item_lista_servico 070202 ou 070203. |
| **CS**       | 96                | Valor numérico **somado** por grupo (ex.: TOTAL ou Unit Price × Qty). |

### 4.2 Regras por linha (antes de agrupar)

- **BI tratado (para Ref/AR):** valor da célula BI; se tiver `>`, pega só a parte **depois do último `>`**; se tiver `_`, pega só a parte **antes do primeiro `_`**. Esse valor vira a **Ref** única do grupo (coluna AR no destino).
- **Texto PO + Line:** `"PO: " & Trim(R) & " Line " & Trim(T)` (se R não vazio). Vários grupos concatenam isso com `"  "` entre cada um.
- **Valor:** valor numérico da coluna CS (senão 0).
- **UF e Município:** do BH – remove `BR_` e `_TAX`, faz `Split` por `_`; `partes(0)` = UF, `partes(1)` = Município.
- **Código serviço:** se AL contém `"7.02"` → `070202`; se contém `"7.03"` → `070203`; senão vazio. Se no grupo aparecer um não vazio, esse fica no destino (último não vazio “vence”).

### 4.3 Agrupamento

- Agrupa por `Trim(BI)` (ignora linha se BI vazio).
- Por grupo:
  - **dictTexto:** concatena todos os `"PO: R Line T"` com `"  "`.
  - **dictSoma:** soma dos valores CS.
  - **dictUF / dictMunicipio:** UF e Município do BH (da primeira linha do grupo).
  - **dictServico:** último `codigoServico` não vazio do grupo (070202 ou 070203).
  - **dictBITratado:** BI tratado (parte antes do `_` depois do último `>`) da primeira linha do grupo.

### 4.4 Preenchimento no destino (Automação 7.02)

Para cada chave do dicionário, escreve **uma linha** com:

| Coluna destino | Conteúdo |
|----------------|----------|
| **R**  | Texto concatenado `"PO: X Line Y  PO: ..."` |
| **X**  | Soma dos valores (CS) → **valor_servico** |
| **T**  | Município (Cidade_Servico) |
| **U**  | UF (UF_Servico) |
| **AP** | UF (repetido) |
| **AD** | item_lista_servico (070202 ou 070203) |
| **AR** | BI tratado → **Ref** única para a API |

As demais colunas da Automação 7.02 (Razão Social, Documento_Tomador, E-mail, endereço, etc.) vêm de **outro passo** da macro ou da aba **Dados** (casamento por CNPJ). Esta macro só preenche essas sete colunas.

---

## 5. Abas auxiliares na macro

- **ISS_Base:** tabela Município, Uf, Cód. Municipio (IBGE 7 dígitos), Aliquota ISS – usada para obter código IBGE e alíquota a partir de cidade/UF.
- **Dados:** uma linha por cliente (CNPJ, Nome Fantasia, E-mail, Logradouro, Número, Complemento, Cidade, Bairro, UF, CEP, codigo municipio, iss_retido, optante_simples_nacional) – usada para preencher tomador e endereço por CNPJ.
- **Instrução:** template de preenchimento (não usado na API).

---

## 6. O que é possível fazer

### Opção A – Transformação na API (recomendado)

Implementar na **API** a mesma lógica que a macro faz:

1. **Novo endpoint** (ex.: `POST /api/upload/emitir`) continua recebendo uma planilha, mas:
   - Se a planilha estiver no **formato portal** (colunas Customer, PO No., Line No., Service_Code, ISS_City, ISS_State, etc. na primeira aba):
     - A API aplica um **mapeamento Portal → Focus** em memória (por linha).
     - Usa uma tabela **ISS_Base** (código IBGE + alíquota por município/UF) – pode ser arquivo JSON, planilha interna ou tabela no banco.
     - Usa uma fonte de **dados dos clientes** (CNPJ → endereço, e-mail): pode ser segunda aba na mesma planilha, arquivo “Dados” separado, ou tabela no banco.
     - Gera **Ref** a partir de PO No. + Line No. (e eventualmente Shipment), com sanitização.
     - Converte **Service_Code** (ex.: 1.07 SUPORTE…) para **item_lista_servico** (ex.: 070202) via tabela de mapeamento (arquivo ou banco).
   - Se a planilha já estiver no **formato Automação 7.02**, a API segue como hoje (sem transformação).
   - Em ambos os casos, ao final chama `montarPayloadNfsen` e envia para a Focus.

2. **Efeito:** o usuário pode enviar **direto a planilha baixada do portal** (xlsx/xlsm), sem abrir Excel nem rodar a macro. A “gambiarra” VBA deixa de ser necessária.

### Opção B – Apenas endpoint de transformação

- **Endpoint:** `POST /api/upload/transformar`
- **Entrada:** planilha do portal (arquivo).
- **Saída:** planilha no formato **Automação 7.02** (xlsx) ou JSON por linha, para o usuário baixar, revisar e depois enviar no fluxo atual de emissão.

Útil se quiserem manter “revisar no Excel” antes de emitir, mas mesmo assim eliminam a macro: a transformação fica na API.

### Opção C – Manter macro e só documentar

- Deixar o fluxo como está e só documentar o mapeamento Portal ↔ Automação 7.02 e o uso das abas ISS_Base e Dados, para manutenção futura da macro.

---

## 7. Detalhes para implementar a transformação (Opção A ou B)

1. **Detecção do formato**  
   - Se na primeira linha/aba existirem colunas como `Customer`, `PO No.`, `Line No.`, `Service_Code`, `ISS_City`, `ISS_State` → tratar como **formato portal**.  
   - Se existirem `Ref`, `Razão Social`, `Documento_Tomador`, `item_lista_servico`, `valor_servico` → tratar como **formato Focus** (comportamento atual).

2. **Ref (portal → Focus)**  
   - Ex.: `Ref = PO No. + "_" + Release No. + "_" + Line No.` (ou incluir Shipment se precisar unicidade), depois `sanitizeRef`.  
   - Definir regra única e documentar.

3. **Tomador (endereço, e-mail)**  
   - Opção 1: planilha do portal pode ter uma **segunda aba “Dados”** com as mesmas colunas da macro (CNPJ, Nome, E-mail, Logradouro, …) e a API faz o join por CNPJ.  
   - Opção 2: **tabela no banco** “clientes” (CNPJ, nome, email, endereço, codigo_municipio, etc.) e a API busca por CNPJ.  
   - Opção 3: **arquivo de configuração** (JSON/planilha) com a lista de clientes.

4. **Código IBGE do município (portal → Focus)**  
   - Portal traz `ISS_City` e `ISS_State`; a Focus exige código IBGE 7 dígitos.  
   - Manter uma tabela **ISS_Base** (como na macro): Município, UF → Cód. Municipio, Aliquota ISS.  
   - Pode ser: JSON no projeto, planilha “ISS_Base” enviada junto ou tabela no banco.

5. **Service_Code → item_lista_servico**  
   - No portal vem texto (ex.: 1.07 SUPORTE TECNICO INFO, 1.06 CONSULT. INF.RET ISS).  
   - Na Focus é código numérico (ex.: 070202).  
   - Criar **mapeamento** (arquivo ou banco): Service_Code ou “código curto” (1.07, 1.06) → código 6 dígitos (070202, etc.).

6. **data_emissao**  
   - Se o portal não enviar, usar **data atual** (ou data de competência configurável).

7. **Grupo obra (E0370)**  
   - Para itens de obra (lista em `upload.js`), a API já exige CEP_Obra, Logradouro_Obra, etc.  
   - No portal pode vir “site” ou outro campo; definir de onde preencher (ex.: site como texto no endereço da obra ou outra aba/coluna).

---

## 8. Resumo

| O que                         | Situação atual                         | Possibilidade                              |
|------------------------------|----------------------------------------|--------------------------------------------|
| Entrada                      | Planilha do portal colada na macro     | Enviar planilha do portal direto na API    |
| Transformação Portal → Focus | Macro VBA no Excel                     | Fazer na API (Node.js)                     |
| Dados do tomador             | Aba “Dados” na macro (por CNPJ)        | Aba “Dados”, banco ou arquivo de config    |
| Código IBGE + alíquota       | Aba “ISS_Base” na macro                | JSON / planilha / tabela no banco          |
| Service_Code → CTN           | Lógica na macro                        | Mapeamento (arquivo ou banco) na API       |
| Emissão                      | Upload da planilha “Automação 7.02”    | Mesmo fluxo; ou aceitar também planilha portal |

Recomendação: implementar a **Opção A** (transformação na API + emissão) para deixar de depender da macro VBA e permitir enviar a planilha do portal direto no sistema. Se quiser, o próximo passo pode ser definir juntos o mapeamento exato das colunas (portal → Focus) e onde ficarão ISS_Base e Dados (arquivo vs banco).
