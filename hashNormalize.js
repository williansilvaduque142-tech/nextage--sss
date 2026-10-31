/**
 * Hashes SHA-256 em hex: Node usa minúsculas; MySQL/phpMyAdmin podem guardar MAIÚSCULAS.
 * Colunas BINARY/BLOB podem vir como Buffer.
 */
function normalizeStoredHash(value) {
  if (value == null || value === undefined) return '';
  if (Buffer.isBuffer(value)) return value.toString('hex').toLowerCase();
  const t = String(value).trim();
  if (/^[0-9a-fA-F]+$/.test(t)) return t.toLowerCase();
  return t;
}

module.exports = { normalizeStoredHash };
