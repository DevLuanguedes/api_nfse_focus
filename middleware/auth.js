// middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Exige um token JWT válido (header Authorization: Bearer <token>).
 * Em caso de sucesso, popula req.usuario = { id, email, role }.
 */
function autenticar(req, res, next) {
  if (!JWT_SECRET) {
    console.error('[auth] JWT_SECRET não configurado.');
    return res.status(500).json({ erro: 'Autenticação não configurada no servidor.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login novamente.' });
  }

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

/**
 * Restringe a rota às roles informadas. Usar sempre depois de `autenticar`.
 * Ex.: router.get('/x', autenticar, permitir('admin', 'operador'), handler)
 */
function permitir(...rolesPermitidas) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    if (!rolesPermitidas.includes(req.usuario.role)) {
      return res.status(403).json({ erro: 'Acesso negado para este perfil de usuário.' });
    }
    next();
  };
}

module.exports = { autenticar, permitir, JWT_SECRET };
