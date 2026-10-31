/**
 * Gera versões ofuscadas dos scripts do painel (public/app.obf.js, public/revendedor.obf.js).
 * O código no navegador nunca fica realmente "escondido"; isto só dificulta leitura casual no F12.
 * Segredos (tokens, webhooks) devem estar só no servidor — nunca nestes ficheiros.
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..', 'public');
const FILES = [
  { in: 'app.js', out: 'app.obf.js' },
  { in: 'revendedor.js', out: 'revendedor.obf.js' },
];

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

for (const { in: srcName, out: outName } of FILES) {
  const srcPath = path.join(ROOT, srcName);
  const outPath = path.join(ROOT, outName);
  if (!fs.existsSync(srcPath)) {
    console.error('[build-client] Ficheiro em falta:', srcPath);
    process.exit(1);
  }
  const code = fs.readFileSync(srcPath, 'utf8');
  const r = JavaScriptObfuscator.obfuscate(code, options);
  fs.writeFileSync(outPath, r.getObfuscatedCode(), 'utf8');
  console.log('[build-client] OK', outName, '(' + Math.round(fs.statSync(outPath).size / 1024) + ' KB)');
}
