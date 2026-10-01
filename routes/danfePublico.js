// routes/danfePublico.js
// Acesso ao DANFE de uma NF-e recebida sem exigir login — protegido por um segredo
// compartilhado (DANFE_PUBLIC_SECRET), não pelo JWT do sistema. Existe porque o relatório
// de flutuação de preços roda como Claude Artifact, cujo sandbox bloqueia chamadas
// autenticadas para o backend.
const express = require('express');
const axios = require('axios');
const router = express.Router();

const FOCUS_TOKEN = process.env.FOCUS_TOKEN;
const FOCUS_URL_RECEBIDAS = 'https://api.focusnfe.com.br/v2/nfes_recebidas';
const DANFE_PUBLIC_SECRET = process.env.DANFE_PUBLIC_SECRET;

router.get('/:chave', async (req, res) => {
  const { chave } = req.params;
  const { s } = req.query;

  if (!DANFE_PUBLIC_SECRET || s !== DANFE_PUBLIC_SECRET) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  if (!/^\d{44}$/.test(chave)) {
    return res.status(400).json({ erro: 'Chave de acesso inválida' });
  }
  if (!FOCUS_TOKEN) {
    return res.status(500).json({ erro: 'FOCUS_TOKEN não configurado' });
  }

  try {
    const resp = await axios.get(`${FOCUS_URL_RECEBIDAS}/${chave}.pdf`, {
      auth: { username: FOCUS_TOKEN, password: '' },
      headers: { Accept: 'application/pdf' },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      return res.status(resp.status).json({ erro: 'Erro ao buscar PDF na Focus NFe' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="nfe_${chave}.pdf"`);
    res.send(resp.data);
  } catch (err) {
    console.error('Erro ao baixar PDF (danfe público):', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
