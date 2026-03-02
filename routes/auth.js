// routes/auth.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

/**
 * POST /api/auth/login
 * Body: { email, senha }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe email e senha.' });
    }

    const result = await db.query(
      `SELECT id, nome, email, senha_hash, role, ativo 
       FROM usuarios
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    const user = result.rows[0];

    if (!user.ativo) {
      return res.status(403).json({ erro: 'Usuário inativo.' });
    }

    const senhaConfere = await bcrypt.compare(senha, user.senha_hash);

    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    const usuarioFront = {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role
    };

    return res.json({
      sucesso: true,
      usuario: usuarioFront
    });

  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ erro: 'Erro interno no login.' });
  }
});

/**
 * GET /api/auth/usuarios
 * Lista todos os usuários (para tela de administração)
 * OBS: por enquanto sem autenticação forte – proteger no front
 */
router.get('/usuarios', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nome, email, role, ativo, created_at, updated_at
       FROM usuarios
       ORDER BY nome`
    );
    res.json(r.rows || []);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ erro: 'Erro ao listar usuários.' });
  }
});

/**
 * POST /api/auth/usuarios
 * Cria novo usuário.
 * Body: { nome, email, senha, role }
 */
router.post('/usuarios', async (req, res) => {
  try {
    const { nome, email, senha, role } = req.body || {};

    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'Informe nome, email e senha.' });
    }

    const hash = await bcrypt.hash(String(senha), 10);
    const papel = role && String(role).trim() ? String(role).trim() : 'operador';

    const result = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, ativo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, nome, email, role, ativo, created_at, updated_at`,
      [nome, email, hash, papel]
    );

    return res.status(201).json({ sucesso: true, usuario: result.rows[0] });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    if (String(err.message || '').includes('unique')) {
      return res.status(400).json({ erro: 'E-mail já cadastrado.' });
    }
    res.status(500).json({ erro: 'Erro ao criar usuário.' });
  }
});

/**
 * PATCH /api/auth/usuarios/:id
 * Atualiza role e/ou ativo.
 * Body: { role?, ativo? }
 */
router.patch('/usuarios/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const { role, ativo } = req.body || {};
    if (role == null && ativo == null) {
      return res.status(400).json({ erro: 'Informe role e/ou ativo para atualizar.' });
    }

    const campos = [];
    const valores = [];
    let idx = 1;

    if (role != null) {
      campos.push(`role = $${idx++}`);
      valores.push(String(role).trim());
    }
    if (ativo != null) {
      campos.push(`ativo = $${idx++}`);
      valores.push(Boolean(ativo));
    }
    valores.push(id);

    const sql = `
      UPDATE usuarios
      SET ${campos.join(', ')}, updated_at = NOW()
      WHERE id = $${idx}
      RETURNING id, nome, email, role, ativo, created_at, updated_at
    `;

    const result = await db.query(sql, valores);
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    res.json({ sucesso: true, usuario: result.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ erro: 'Erro ao atualizar usuário.' });
  }
});

module.exports = router;
