// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

// ===== APP =====
const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARES =====
app.use(cors());
app.use(express.json());

// ===== ROTAS =====
const notasRoutes = require('./routes/notas');
const notasRecebidasRoutes = require('./routes/notasRecebidas');
const nfeRecebidasRoutes = require('./routes/nfeRecebidas');
const dashboardRoutes = require('./routes/dashboard');
const debugRoutes = require('./routes/debug');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const municipiosAliquotasRoutes = require('./routes/municipiosAliquotas');
const siteEnderecosRoutes = require('./routes/siteEnderecos');
const webhookRoutes = require("./routes/webhook");
const { autenticar, permitir } = require('./middleware/auth');

app.use("/webhook", webhookRoutes);

// ===== ROTA TESTE + VERSÃO (antes do static para garantir que respondam) =====
app.get('/', (req, res) => {
  res.json({ mensagem: 'API SIG NFSe rodando' });
});

app.get('/api/versao', (req, res) => {
  res.json({
    versao: '3',
    transformacao: 'colunas-por-nome-regras-070202-BH-PoShipTo',
    poShipTo: true,
    pedirCadastroISS: true,
    locationBH: true,
    mensagem: 'Cidade/UF vêm da coluna BH (PO Ship To), não da Location.',
  });
});

// ===== REGISTRO DAS ROTAS =====
// Roles: 'admin' e 'operador' têm acesso completo; 'consulta_recebidas' só vê notas recebidas.
const TODAS_ROLES = ['admin', 'operador', 'consulta_recebidas'];
const ROLES_COMPLETAS = ['admin', 'operador'];

app.use('/api/notas', autenticar, permitir(...ROLES_COMPLETAS), notasRoutes);
app.use('/api/notas-recebidas', autenticar, permitir(...TODAS_ROLES), notasRecebidasRoutes);
app.use('/api/nfe-recebidas', autenticar, permitir(...TODAS_ROLES), nfeRecebidasRoutes);
app.use('/api/dashboard', autenticar, permitir(...ROLES_COMPLETAS), dashboardRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/upload', autenticar, permitir(...ROLES_COMPLETAS), uploadRoutes);
app.use('/api/municipios-aliquotas', autenticar, permitir(...ROLES_COMPLETAS), municipiosAliquotasRoutes);
app.use('/api/site-enderecos', autenticar, permitir(...ROLES_COMPLETAS), siteEnderecosRoutes);

// Painel (frontend): http://localhost:3000/painel.html (depois das rotas de API)
app.use(express.static(path.join(__dirname, 'Sistema de Gestão - Premcell')));

// ===== SOBE O SERVIDOR =====
const VERSAO_SERVIDOR = '3';
const db = require('./db');
app.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT} [versão ${VERSAO_SERVIDOR} - BH fixo para cidade/UF, colunas por nome, regras 070202]`);
  try {
    await db.query('SELECT 1');
    console.log('[db] Conexão OK');
  } catch (err) {
    console.error('[db] Erro:', err.message);
  }
});
