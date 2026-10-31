-- Garantir contas de painel admin/silva no MySQL (phpMyAdmin).
-- Senha em texto = valor de ADMIN_SECRET no .env (predefinição do servidor: 21).
-- Hash SHA-256 hex dessa senha (igual ao Node: crypto.createHash('sha256').update('21').digest('hex')):
-- Se o seu ADMIN_SECRET no .env for outro, regenere o hash ou deixe o Node criar as linhas no primeiro login.

INSERT IGNORE INTO silva_users (username, password_hash, role, last_login_at, bound_ip, secret_phrase_hash)
VALUES
  ('admin', '6f4b6612125fb3a0daecd2799dfd6c9c299424fd920f9b308110a2c1fbd8f443', 'owner', NULL, NULL, NULL),
  ('silva', '6f4b6612125fb3a0daecd2799dfd6c9c299424fd920f9b308110a2c1fbd8f443', 'owner', NULL, NULL, NULL);
