-- =============================================================================
-- UPGRADE MySQL / MariaDB — pode executar VÁRIAS VEZES sem erro (idempotente).
-- No phpMyAdmin: escolha o seu banco → separador SQL → cole tudo → Executar.
-- =============================================================================

-- Tabelas que às vezes faltam (CREATE só cria se não existir)
CREATE TABLE IF NOT EXISTS silva_mp_credited (
  payment_id VARCHAR(64) PRIMARY KEY
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

CREATE TABLE IF NOT EXISTS silva_keys (
  id VARCHAR(255) PRIMARY KEY,
  usuario VARCHAR(255) NOT NULL,
  added_at DATETIME NOT NULL,
  expires_in_seconds INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS silva_users (
  username VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'staff',
  secret_phrase_hash VARCHAR(64) NULL,
  last_login_at DATETIME NULL,
  bound_ip VARCHAR(64) NULL
);

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

CREATE TABLE IF NOT EXISTS silva_redeem_keys (
  code VARCHAR(255) PRIMARY KEY,
  expires_in_seconds INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  used_by VARCHAR(255) NULL,
  created_by_reseller VARCHAR(255) NULL,
  paused TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS silva_dll_meta (
  id INT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS silva_dll_content (
  id INT PRIMARY KEY,
  content LONGBLOB NULL
);

-- ---------------------------------------------------------------------------
-- Colunas em falta (só ADD se a coluna ainda não existir — sem "Duplicate column")
-- ---------------------------------------------------------------------------

-- silva_users
SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'bound_ip';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_users ADD COLUMN bound_ip VARCHAR(64) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'secret_phrase_hash';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_users ADD COLUMN secret_phrase_hash VARCHAR(64) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'role';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT ''staff''', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'last_login_at';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_users ADD COLUMN last_login_at DATETIME NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

-- silva_resellers
SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'bound_ip';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN bound_ip VARCHAR(64) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'avatar_url';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN avatar_url MEDIUMTEXT NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'secret_phrase_hash';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN secret_phrase_hash VARCHAR(64) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'secret_phrase_plain';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN secret_phrase_plain VARCHAR(200) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'recovery_email';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN recovery_email VARCHAR(255) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'password_reset_token_hash';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN password_reset_token_hash VARCHAR(64) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'password_reset_expires';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_resellers ADD COLUMN password_reset_expires DATETIME NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

-- silva_redeem_keys
SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_redeem_keys' AND COLUMN_NAME = 'created_by_reseller';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_redeem_keys ADD COLUMN created_by_reseller VARCHAR(255) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_redeem_keys' AND COLUMN_NAME = 'paused';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_redeem_keys ADD COLUMN paused TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

-- silva_loader_accounts
SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'hwid';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN hwid VARCHAR(512) NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'skip_hwid_check';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN skip_hwid_check TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'paused';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN paused TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'expires_at';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN expires_at DATETIME NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'created_at';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'last_login_at';
SET @silva_q = IF(@silva_c = 0, 'ALTER TABLE silva_loader_accounts ADD COLUMN last_login_at DATETIME NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

-- DLL slots (7 ficheiros) — só insere linhas em falta
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

-- Se setting_value ainda for TEXT, passa a MEDIUMTEXT (evita erro em JSONs grandes)
SELECT COUNT(*) INTO @silva_c FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_settings' AND COLUMN_NAME = 'setting_value' AND LOWER(DATA_TYPE) = 'text';
SET @silva_q = IF(@silva_c > 0, 'ALTER TABLE silva_settings MODIFY COLUMN setting_value MEDIUMTEXT NOT NULL', 'SELECT 1');
PREPARE silva_stmt FROM @silva_q;
EXECUTE silva_stmt;
DEALLOCATE PREPARE silva_stmt;

-- ---------------------------------------------------------------------------
-- Conta para entrar no painel (INSERT IGNORE = não sobrescreve se já existir)
-- Usuário: admin ou silva  |  Senha: admin123
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO silva_users (username, password_hash, role, last_login_at, bound_ip, secret_phrase_hash) VALUES
('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'owner', NULL, NULL, NULL),
('silva', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'owner', NULL, NULL, NULL);
