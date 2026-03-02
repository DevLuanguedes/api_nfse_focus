// scripts/criar_usuario_admin.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

async function criarUsuarioAdmin() {
  try {
    const nome = 'Pedro Ferreira';
    const email = 'nf@premcell.com.br';
    const senhaPura = 'adminnf'; 
    const role = 'admin';

    const senhaHash = await bcrypt.hash(senhaPura, 10);

    const result = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, ativo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, nome, email, role`,
      [nome, email, senhaHash, role]
    );

    console.log('Usuário admin criado com sucesso:');
    console.log(result.rows[0]);
    console.log(`Use para login: email=${email} senha=${senhaPura}`);

    process.exit(0);
  } catch (err) {
    console.error('Erro ao criar usuário admin:', err);
    process.exit(1);
  }
}

criarUsuarioAdmin();
