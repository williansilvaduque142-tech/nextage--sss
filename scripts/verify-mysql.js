#!/usr/bin/env node
/**
 * Testa a ligação MySQL com as mesmas variáveis que o servidor usa.
 * Uso: node scripts/verify-mysql.js
 * Ou: npm run verify:mysql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const store = require('../store.js');

function mask(s) {
  if (s == null || s === '') return '(vazio)';
  const t = String(s);
  if (t.length <= 2) return '***';
  return t.slice(0, 2) + '***' + (t.length > 4 ? t.slice(-1) : '');
}

function hints(e) {
  const code = e && e.code;
  console.error('');
  if (code === 'ECONNREFUSED') {
    console.error('  → Ligação recusada: host/porta errados ou MySQL não aceita este cliente.');
    console.error('  → Se o Node corre no teu PC: não uses MYSQL_HOST=localhost; usa o hostname');
    console.error('    do hPanel (MySQL) e adiciona o teu IP em "Acesso remoto MySQL".');
  } else if (code === 'ENOTFOUND') {
    console.error('  → Hostname desconhecido (DNS). Verifica MYSQL_HOST.');
  } else if (code === 'ETIMEDOUT') {
    console.error('  → Timeout: firewall, IP não autorizado no MySQL remoto, ou host errado.');
  } else if (code === 'ER_ACCESS_DENIED_ERROR' || /access denied/i.test(String(e.message))) {
    console.error('  → Utilizador/senha incorretos ou utilizador sem permissão a partir deste IP.');
  } else if (code === 'ER_BAD_DB_ERROR' || /unknown database/i.test(String(e.message))) {
    console.error('  → Base de dados inexistente. Confirma MYSQL_DATABASE (ex.: u521311849_luaexecutor).');
  }
  console.error('');
  console.error('  phpMyAdmin (ex.: auth-db….hstgr.io) é só a página web; MYSQL_HOST vem do hPanel');
  console.error('  em "Bases de dados MySQL" → Servidor MySQL (muitas vezes localhost no servidor).');
  console.error('');
}

if (!store.USE_MYSQL) {
  console.error('[!] MySQL não está configurado.');
  console.error('    Cria um ficheiro .env na raiz do projeto com, por exemplo:');
  console.error('    MYSQL_HOST=localhost');
  console.error('    MYSQL_USER=o_teu_user_mysql');
  console.error('    MYSQL_PASSWORD=a_tua_senha');
  console.error('    MYSQL_DATABASE=u521311849_luaexecutor');
  console.error('    (ou MYSQL_URI=mysql://user:pass@host:3306/base)');
  process.exit(2);
}

const uri = process.env.MYSQL_URI || process.env.DATABASE_URL;
if (uri && String(uri).startsWith('mysql')) {
  console.log('[*] Modo: MYSQL_URI / DATABASE_URL (mysql)');
} else {
  console.log('[*] Modo: MYSQL_HOST / MYSQL_USER / MYSQL_DATABASE');
  console.log('    Host:', process.env.MYSQL_HOST || 'localhost');
  console.log('    Port:', process.env.MYSQL_PORT || '3306');
  console.log('    User:', process.env.MYSQL_USER || '?');
  console.log('    Database:', process.env.MYSQL_DATABASE || '?');
  console.log('    Password:', mask(process.env.MYSQL_PASSWORD));
  if (String(process.env.MYSQL_SSL || '').match(/^(1|true|yes)$/i)) {
    console.log('    SSL: ativo');
  }
}

console.log('[*] A testar SELECT 1...');

require('../store-mysql')
  .pingDb()
  .then(() => {
    console.log('[OK] MySQL respondeu. O .env está acessível a partir desta máquina.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[ERRO]', e.message || String(e));
    if (e.code) console.error('    código:', e.code);
    hints(e);
    process.exit(1);
  });
