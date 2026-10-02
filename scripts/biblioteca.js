#!/usr/bin/env node
/**
 * Publica botCiro como biblioteca de Apps Script y mantiene la hoja plantilla que copia cada persona.
 *
 *   node scripts/biblioteca.js crear            una vez: crea el proyecto de la biblioteca
 *   node scripts/biblioteca.js plantilla-crear  una vez: crea la hoja plantilla con su script
 *   node scripts/biblioteca.js satelite-crear   una vez: crea la hoja plantilla del satélite (cuenta de trabajo)
 *   node scripts/biblioteca.js publicar         cada versión: build → push → versión → plantilla
 *
 * Los IDs quedan en biblioteca.json (no son secretos). Usa la sesión de clasp de tu cuenta personal.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const BUILD = path.join(RAIZ, 'build', 'biblioteca');
const PLANTILLA = path.join(RAIZ, 'plantilla');
const CONFIG = path.join(RAIZ, 'biblioteca.json');
const SATELITE = path.join(RAIZ, 'build', 'satelite-plantilla');

const leerConfig = () => (fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')) : {});
const guardarConfig = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n');

function clasp(args, cwd) {
  console.log(`$ clasp ${args.join(' ')}   (${path.relative(RAIZ, cwd) || '.'})`);
  return execFileSync('clasp', args, { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
}

/** Como clasp(), pero devuelve la salida aunque termine con error (clasp versions falla si no hay versiones). */
function claspSalida(args, cwd) {
  console.log(`$ clasp ${args.join(' ')}   (${path.relative(RAIZ, cwd) || '.'})`);
  try {
    return execFileSync('clasp', args, { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  } catch (err) {
    return String(err.stdout || '') + String(err.stderr || '');
  }
}

function reemplazar(texto, antes, despues, archivo) {
  if (!texto.includes(antes)) throw new Error(`No encontré "${antes}" en ${archivo}`);
  return texto.replace(antes, despues);
}

/** Cambios de un archivo de src/ para el build de biblioteca (también lo usan los tests). */
function transformar(f, s, numero) {
  if (f === 'Contexto.js') s = reemplazar(s, 'const MODO_BIBLIOTECA_ = false;', 'const MODO_BIBLIOTECA_ = true;', f);
  if (f === 'Version.js') {
    s = reemplazar(s, 'const NUMERO_BIBLIOTECA = 0;', `const NUMERO_BIBLIOTECA = ${numero};`, f);
    const satelite = leerConfig().sateliteHojaId;
    if (satelite) s = reemplazar(s, "const URL_PLANTILLA_SATELITE = '';", `const URL_PLANTILLA_SATELITE = 'https://docs.google.com/spreadsheets/d/${satelite}/copy';`, f);
  }
  if (f === 'appsscript.json') {
    const m = JSON.parse(s);
    delete m.webapp; // la app web es de cada copia, no de la biblioteca
    s = JSON.stringify(m, null, 2) + '\n';
  }
  return s;
}

/** Copia src/ a build/biblioteca en modo biblioteca, con el número de versión que se va a crear. */
function build(numero) {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  for (const f of fs.readdirSync(path.join(RAIZ, 'src'))) {
    fs.writeFileSync(path.join(BUILD, f), transformar(f, fs.readFileSync(path.join(RAIZ, 'src', f), 'utf8'), numero));
  }
  const config = leerConfig();
  if (config.scriptId) fs.writeFileSync(path.join(BUILD, '.clasp.json'), JSON.stringify({ scriptId: config.scriptId, rootDir: '.' }));
}

function siguienteNumero() {
  const salida = claspSalida(['versions'], BUILD);
  const numeros = salida.split('\n').map((l) => /^\s*(\d+)\s+-/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  if (!numeros.length && !/No deployed versions/i.test(salida)) {
    throw new Error('No pude leer las versiones de la biblioteca:\n' + salida);
  }
  return (numeros.length ? Math.max(...numeros) : 0) + 1;
}

function crear() {
  const config = leerConfig();
  if (config.scriptId) throw new Error('La biblioteca ya existe: ' + config.scriptId);
  build(0);
  clasp(['create', '--type', 'standalone', '--title', 'BotCiro (biblioteca)', '--rootDir', '.'], BUILD);
  const { scriptId } = JSON.parse(fs.readFileSync(path.join(BUILD, '.clasp.json'), 'utf8'));
  guardarConfig(Object.assign(config, { scriptId }));
  console.log(`\nBiblioteca creada: ${scriptId}
Compártela: en Drive, "BotCiro (biblioteca)" → Compartir → Cualquier persona con el enlace: Lector.
NUNCA guardes secretos en sus Propiedades del script: todas las copias pueden leerlas.
Luego: npm run biblioteca:publicar`);
}

function plantillaCrear() {
  const config = leerConfig();
  if (!config.scriptId) throw new Error('Primero crea la biblioteca: npm run biblioteca:crear');
  if (config.plantillaScriptId) throw new Error('La plantilla ya existe: ' + config.plantillaScriptId);
  const respaldo = fs.readFileSync(path.join(PLANTILLA, 'appsscript.json'), 'utf8');
  if (respaldo.includes('ID_DE_LA_BIBLIOTECA')) throw new Error('Primero publica la biblioteca: npm run biblioteca:publicar');
  try {
    clasp(['create', '--type', 'sheets', '--title', 'Asistente personal (plantilla)', '--rootDir', '.'], PLANTILLA);
  } finally {
    fs.writeFileSync(path.join(PLANTILLA, 'appsscript.json'), respaldo); // clasp create sobrescribe el manifiesto
  }
  clasp(['push', '--force'], PLANTILLA);
  const { scriptId, parentId } = JSON.parse(fs.readFileSync(path.join(PLANTILLA, '.clasp.json'), 'utf8'));
  const hoja = Array.isArray(parentId) ? parentId[0] : parentId;
  guardarConfig(Object.assign(config, { plantillaScriptId: scriptId, plantillaHojaId: hoja }));
  console.log(`\nPlantilla creada. Compártela como Lector y reparte este enlace:
https://docs.google.com/spreadsheets/d/${hoja}/copy`);
}

/** El satélite como plantilla: mismo Satelite.js, con permiso para el menú de la hoja. */
function buildSatelite() {
  fs.rmSync(SATELITE, { recursive: true, force: true });
  fs.mkdirSync(SATELITE, { recursive: true });
  fs.copyFileSync(path.join(RAIZ, 'satelite', 'Satelite.js'), path.join(SATELITE, 'Satelite.js'));
  const m = JSON.parse(fs.readFileSync(path.join(RAIZ, 'satelite', 'appsscript.json'), 'utf8'));
  m.oauthScopes.push('https://www.googleapis.com/auth/script.container.ui');
  fs.writeFileSync(path.join(SATELITE, 'appsscript.json'), JSON.stringify(m, null, 2) + '\n');
  const config = leerConfig();
  if (config.sateliteScriptId) fs.writeFileSync(path.join(SATELITE, '.clasp.json'), JSON.stringify({ scriptId: config.sateliteScriptId, rootDir: '.' }));
}

function sateliteCrear() {
  const config = leerConfig();
  if (config.sateliteScriptId) throw new Error('La plantilla del satélite ya existe: ' + config.sateliteScriptId);
  buildSatelite();
  const manifiesto = fs.readFileSync(path.join(SATELITE, 'appsscript.json'), 'utf8');
  clasp(['create', '--type', 'sheets', '--title', 'Asistente · satélite de trabajo (plantilla)', '--rootDir', '.'], SATELITE);
  fs.writeFileSync(path.join(SATELITE, 'appsscript.json'), manifiesto);
  clasp(['push', '--force'], SATELITE);
  const { scriptId, parentId } = JSON.parse(fs.readFileSync(path.join(SATELITE, '.clasp.json'), 'utf8'));
  const hoja = Array.isArray(parentId) ? parentId[0] : parentId;
  guardarConfig(Object.assign(config, { sateliteScriptId: scriptId, sateliteHojaId: hoja }));
  console.log(`\nPlantilla del satélite creada. Compártela como Lector (cualquiera con el enlace).
El bot la ofrece en /configurar → Trabajo desde la próxima publicación de la biblioteca.`);
}

function publicar() {
  const config = leerConfig();
  if (!config.scriptId) throw new Error('Primero crea la biblioteca: npm run biblioteca:crear');
  const version = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(RAIZ, 'src', 'Version.js'), 'utf8'))[1];

  build(0);
  const numero = siguienteNumero();
  build(numero);
  clasp(['push', '--force'], BUILD);
  const creada = clasp(['version', `v${version}`], BUILD);
  const m = /Created version (\d+)/i.exec(creada);
  if (!m || Number(m[1]) !== numero) {
    throw new Error(`Se esperaba la versión ${numero} y clasp respondió: ${creada}\nVuelve a publicar para que el número coincida.`);
  }

  // Las copias nuevas de la plantilla arrancan en esta versión.
  const manifiesto = path.join(PLANTILLA, 'appsscript.json');
  const plantilla = JSON.parse(fs.readFileSync(manifiesto, 'utf8'));
  plantilla.dependencies.libraries[0].libraryId = config.scriptId;
  plantilla.dependencies.libraries[0].version = String(numero);
  fs.writeFileSync(manifiesto, JSON.stringify(plantilla, null, 2) + '\n');
  if (config.plantillaScriptId) {
    fs.writeFileSync(path.join(PLANTILLA, '.clasp.json'), JSON.stringify({ scriptId: config.plantillaScriptId, rootDir: '.' }));
    clasp(['push', '--force'], PLANTILLA);
  }
  if (config.sateliteScriptId) {
    buildSatelite();
    clasp(['push', '--force'], SATELITE);
  }

  console.log(`\n✅ Biblioteca v${version} publicada como versión ${numero}.
Último paso, para que las copias reciban el aviso: abre la biblioteca (cd build/biblioteca && clasp open)
y ejecuta anunciarVersion().`);
}

module.exports = { transformar };

if (require.main === module) {
  const acciones = { build: () => build(0), crear, 'plantilla-crear': plantillaCrear, 'satelite-crear': sateliteCrear, publicar };
  const accion = acciones[process.argv[2]];
  if (!accion) {
    console.error('Uso: node scripts/biblioteca.js crear | plantilla-crear | satelite-crear | publicar | build');
    process.exit(1);
  }
  try {
    accion();
  } catch (err) {
    console.error('❌ ' + err.message);
    process.exit(1);
  }
}
