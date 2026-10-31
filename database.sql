-- Schema alinhado com store-mysql.js (Node). Importe no phpMyAdmin antes de usar o site.
-- Se já importou uma versão antiga: execute database-upgrade-mysql.sql (idempotente, pode repetir).

CREATE TABLE IF NOT EXISTS silva_users (
  username VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  -- Cargo: owner OU dono (máximo) | staff OU admin (gestão) | ajudante OU suporte (só Loader users)
  role VARCHAR(32) NOT NULL DEFAULT 'staff',
  secret_phrase_hash VARCHAR(64) NULL,
  last_login_at DATETIME NULL,
  bound_ip VARCHAR(64) NULL
);
-- Ex.: UPDATE silva_users SET role = 'owner' WHERE username = 'meuuser';
-- Senha é SHA-256 hex da string (igual ao Node: crypto.createHash('sha256').update(senha).digest('hex')).

CREATE TABLE IF NOT EXISTS silva_resellers (
  username VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  secret_phrase_hash VARCHAR(64) NULL,
  secret_phrase_plain VARCHAR(200) NULL,
  bound_ip VARCHAR(64) NULL,
  avatar_url MEDIUMTEXT NULL,
  recovery_email VARCHAR(255) NULL,
  password_reset_token_hash VARCHAR(64) NULL,
  password_reset_expires DATETIME NULL
);

CREATE TABLE IF NOT EXISTS silva_loader_accounts (
  username VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  hwid VARCHAR(512) NULL,
  skip_hwid_check TINYINT NOT NULL DEFAULT 0,
  paused TINYINT NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  last_login_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS silva_keys (
  id VARCHAR(255) PRIMARY KEY,
  usuario VARCHAR(255) NOT NULL,
  added_at DATETIME NOT NULL,
  expires_in_seconds INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS silva_redeem_keys (
  code VARCHAR(255) PRIMARY KEY,
  expires_in_seconds INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  used_by VARCHAR(255) NULL,
  created_by_reseller VARCHAR(255) NULL,
  paused TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS silva_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value MEDIUMTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS silva_activity (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  detail TEXT NULL,
  actor VARCHAR(255) NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS silva_dll_meta (
  id INT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS silva_dll_content (
  id INT PRIMARY KEY,
  content LONGBLOB NULL
);

CREATE TABLE IF NOT EXISTS silva_mp_credited (
  payment_id VARCHAR(64) PRIMARY KEY
);

INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES
(1, 'loader.dll'),
(2, 'FATALY.dll'),
(3, 'NEXTMENU.dll'),
(4, 'FATALYPLAY.dll'),
(5, 'LuaExecutor.dll'),
(6, 'LuaExecutor.dll'),
(7, 'liblincdev.so');

INSERT IGNORE INTO silva_dll_content (id, content) VALUES
(1, NULL),(2, NULL),(3, NULL),(4, NULL),(5, NULL),(6, NULL),(7, NULL);

-- Login do painel /admin (SHA-256 da senha em hex, igual ao Node e ao PHP do projeto)
-- Usuário: admin  |  Senha: admin123  — altere depois no painel ou aqui no banco.
INSERT IGNORE INTO silva_users (username, password_hash, role, last_login_at, bound_ip, secret_phrase_hash) VALUES
('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'owner', NULL, NULL, NULL),
('silva', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'owner', NULL, NULL, NULL);
