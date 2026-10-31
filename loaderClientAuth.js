/**
 * Protecao das rotas de download DLL usadas pelo Lua Executor (injector).
 *
 * Este ficheiro fica na mesma pasta que server.js (InfernusLoaderCpp/Lua Corp).
 * O server.js ja chama mountLoaderClientProtection(app) apos express.json.
 *
 * Variavel de ambiente (Vercel / .env):
 *   LOADER_CLIENT_KEY=lua-exec-client-CHANGE-THIS-KEY
 * O mesmo valor deve estar ofuscado em InfernusLoaderCpp/main.cpp (array g_encClientKey, xor kSecretXor).
 * Se LOADER_CLIENT_KEY nao estiver definida, o middleware nao bloqueia (compativel com dev antigo).
 *
 * Nota: GET /api/loader/product-flags nao e protegido aqui — o painel web precisa ler sem chave no
 * navegador (senao a chave apareceria no JavaScript). So os downloads de DLL ficam bloqueados.
 *
 * Regenerar g_encClientKey no C++ (PowerShell, chave 0x5C):
 *   $k=0x5C; [char[]]'sua-chave-secreta' | ForEach-Object { [int][char]$_ -bxor $k }
 * (use apenas ASCII na chave)
 */

function createLoaderClientKeyGate() {
  const required = process.env.LOADER_CLIENT_KEY;
  const trimmed = required != null ? String(required).trim() : '';
  if (!trimmed) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    const sent = (req.get('x-lua-executor-key') || '').trim();
    if (sent !== trimmed) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(403).type('application/json').send(JSON.stringify({ error: 'Cliente nao autorizado.' }));
    }
    next();
  };
}

function mountLoaderClientProtection(app) {
  if (!app || typeof app.use !== 'function') return;
  const gate = createLoaderClientKeyGate();
  app.use('/api/dll/download', (req, res, next) => {
    if (req.method !== 'GET') return next();
    return gate(req, res, next);
  });
}

module.exports = { createLoaderClientKeyGate, mountLoaderClientProtection };
