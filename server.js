// Servidor do Portal Gateway & SSO Unificado (SPD · ED · Sistema-ETS)
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('.', import.meta.url)));

// Carrega variáveis do .env se existir
function carregarEnv() {
  for (const caminho of [resolve(RAIZ, '.env'), resolve(RAIZ, '../backend/.env')]) {
    if (!existsSync(caminho)) continue;
    const linhas = readFileSync(caminho, 'utf8').split(/\r?\n/);
    for (const linha of linhas) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const idx = limpa.indexOf('=');
      if (idx < 1) continue;
      const chave = limpa.slice(0, idx).trim();
      const valor = limpa.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[chave] === undefined) process.env[chave] = valor;
    }
  }
}
carregarEnv();

export const CONFIG = {
  porta: Number(process.env.GATEWAY_PORT ?? 4000),
  host: process.env.GATEWAY_HOST ?? '0.0.0.0',
  ssoSecret: process.env.SSO_SECRET || process.env.JWT_SECRET || 'dda44fc86d93b0f196a4ad1612a17e9cfd451e3f29f9e25ad3bec3fab02030df82765460ededd62e84ff65d54f179d94',
  // URLs públicas (acessadas pelo navegador do usuário nos redirecionamentos SSO)
  spdUrl: (process.env.SPD_PUBLIC_URL || process.env.SPD_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  edUrl: (process.env.ED_PUBLIC_URL || process.env.ED_URL || 'http://localhost:3001').replace(/\/+$/, ''),
  etsUrl: (process.env.ETS_PUBLIC_URL || process.env.ETS_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  // URLs internas (usadas pelo container do Gateway para healthcheck e APIs internas na rede Docker)
  spdInternalUrl: (process.env.SPD_INTERNAL_URL || process.env.SPD_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  edInternalUrl: (process.env.ED_INTERNAL_URL || process.env.ED_URL || 'http://localhost:3001').replace(/\/+$/, ''),
  etsInternalUrl: (process.env.ETS_INTERNAL_URL || process.env.ETS_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  adminName: process.env.GATEWAY_ADMIN_NAME || process.env.ADMIN_NAME || 'Administrador do Sistema',
  adminEmail: (process.env.GATEWAY_ADMIN_USER || process.env.ADMIN_EMAIL || 'admin@spd.local').toLowerCase(),
  adminLogin: (process.env.GATEWAY_ADMIN_SIAPE || 'admin').toLowerCase(),
  adminPass: process.env.GATEWAY_ADMIN_PASS || process.env.ADMIN_PASSWORD || 'admin123'
};

export function assinarTokenSso(payload, secret = CONFIG.ssoSecret, expiresInSeconds = 8 * 3600) {
  const agora = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const corpo = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: agora,
      exp: agora + expiresInSeconds,
      iss: 'ufpb-gateway-sso'
    })
  ).toString('base64url');
  const assinatura = createHmac('sha256', secret).update(`${header}.${corpo}`).digest('base64url');
  return `${header}.${corpo}.${assinatura}`;
}

export function verificarTokenSso(token, secret = CONFIG.ssoSecret) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [header, corpo, assinatura] = partes;
  const esperada = createHmac('sha256', secret).update(`${header}.${corpo}`).digest('base64url');
  const bufA = Buffer.from(assinatura);
  const bufB = Buffer.from(esperada);
  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

const TIPOS_ARQUIVO = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function enviarJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(corpo);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error('Payload muito grande'));
        return;
      }
      partes.push(chunk);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

async function tentarAutenticarNoSpd(identificador, senha) {
  try {
    const res = await fetch(`${CONFIG.spdInternalUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: identificador, senha }),
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (data?.usuario) {
      return {
        ok: true,
        origem: 'SPD',
        spdToken: data.token,
        usuario: {
          id: data.usuario.id,
          nome: data.usuario.nome,
          email: data.usuario.email,
          usuario: data.usuario.siape || data.usuario.email?.split('@')[0] || identificador,
          siape: data.usuario.siape || null,
          docente_id: data.usuario.docente_id || null,
          role: data.usuario.role === 'ADMIN' ? 'ADMIN' : 'VISITANTE',
          perfil: data.usuario.role === 'ADMIN' ? 'admin' : 'visitante'
        }
      };
    }
  } catch {
    // SPD indisponível no momento
  }
  return { ok: false, offline: true };
}

async function tentarAutenticarNoEd(identificador, senha) {
  try {
    const usuarioLimpo = String(identificador).toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '');
    const res = await fetch(`${CONFIG.edInternalUrl}/api/entrar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ED'
      },
      body: JSON.stringify({ usuario: usuarioLimpo, senha }),
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (data?.usuario) {
      const isAdm = data.usuario.perfil === 'admin';
      const emailCalculado = identificador.includes('@')
        ? identificador.toLowerCase()
        : `${data.usuario.usuario}@ufpb.br`;
      return {
        ok: true,
        origem: 'ED',
        usuario: {
          id: data.usuario.id,
          nome: data.usuario.nome,
          email: emailCalculado,
          usuario: data.usuario.usuario,
          siape: /^\d{7}$/.test(data.usuario.usuario) ? data.usuario.usuario : null,
          role: isAdm ? 'ADMIN' : 'VISITANTE',
          perfil: isAdm ? 'admin' : 'visitante'
        }
      };
    }
  } catch {
    // ED indisponível no momento
  }
  return { ok: false, offline: true };
}

async function checarSaude(url, caminho = '/') {
  const inicio = Date.now();
  try {
    const res = await fetch(`${url}${caminho}`, {
      method: 'GET',
      signal: AbortSignal.timeout(2200)
    });
    return {
      online: res.status < 500,
      status: res.status,
      latenciaMs: Date.now() - inicio
    };
  } catch {
    return {
      online: false,
      status: 0,
      latenciaMs: null
    };
  }
}

export function criarServidorGateway() {
  const PUBLICO = resolve(RAIZ, 'public');

  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      return res.end();
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const caminho = url.pathname;

    // 1. Configuração dos sistemas e status de conectividade
    if (req.method === 'GET' && caminho === '/api/sistemas') {
      const [spdStatus, edStatus, etsStatus] = await Promise.all([
        checarSaude(CONFIG.spdInternalUrl, '/health'),
        checarSaude(CONFIG.edInternalUrl, '/api/saude'),
        checarSaude(CONFIG.etsInternalUrl, '/login')
      ]);

      return enviarJson(res, 200, {
        sistemas: [
          {
            id: 'spd',
            sigla: 'SPD',
            nome: 'Sistema de Presença Docente',
            subtitulo: 'Gestão de Assiduidade de Colegiado • UFPB',
            descricao: 'Controle de reuniões de colegiado, lançamento de frequência com OCR de atas, justificativas de faltas e índices de assiduidade.',
            url: CONFIG.spdUrl,
            ssoPath: '/?sso_token=',
            cor: '#14213d',
            destaque: '#d97706',
            tags: ['Reuniões', 'Frequência & OCR', 'Colegiados', 'Relatórios'],
            status: spdStatus
          },
          {
            id: 'ed',
            sigla: 'ED',
            nome: 'Encargos Docentes',
            subtitulo: 'Distribuição e Pontuação de Encargos • UFPB',
            descricao: 'Cadastro de encargos administrativos e acadêmicos, pesos, portarias, vigências e ranking de pontuação docente por período.',
            url: CONFIG.edUrl,
            ssoPath: '/api/sso?token=',
            cor: '#0f2942',
            destaque: '#c98a12',
            tags: ['Encargos & Pesos', 'Portarias', 'Ranking Docente', 'Auditoria'],
            status: edStatus
          },
          {
            id: 'ets',
            sigla: 'ETS',
            nome: 'Sistema ETS / UFPB',
            subtitulo: 'Análise de Cargas Horárias de Cursos • ETS',
            descricao: 'Gestão acadêmica de cursos, módulos, semestres, ofertas de disciplinas, registros de aulas ministradas e extratos curriculares.',
            url: CONFIG.etsUrl,
            ssoPath: '/sso/login?token=',
            cor: '#12345a',
            destaque: '#2563eb',
            tags: ['Cursos & Módulos', 'Ofertas', 'Carga Horária', 'Extratos'],
            status: etsStatus
          }
        ]
      });
    }

    // 2. Login Unificado (emite token SSO válido para os 3 sistemas)
    if (req.method === 'POST' && caminho === '/api/auth/login') {
      const corpo = await lerCorpo(req);
      const identificador = String(corpo.identificador ?? corpo.email ?? corpo.usuario ?? '').trim();
      const senha = String(corpo.senha ?? '');

      if (!identificador || !senha) {
        return enviarJson(res, 400, { error: 'Informe seu E-mail, SIAPE ou Usuário e a senha.' });
      }

      // Tenta autenticar no SPD ou no ED em paralelo
      const [resSpd, resEd] = await Promise.all([
        tentarAutenticarNoSpd(identificador, senha),
        tentarAutenticarNoEd(identificador, senha)
      ]);

      let usuarioAutenticado = null;
      let origem = null;

      if (resSpd.ok) {
        usuarioAutenticado = resSpd.usuario;
        origem = 'SPD';
      } else if (resEd.ok) {
        usuarioAutenticado = resEd.usuario;
        origem = 'ED';
      } else {
        // Fallback: Administrador configurado no Gateway/.env
        const idLower = identificador.toLowerCase();
        const isAdminMatch =
          (idLower === CONFIG.adminEmail || idLower === CONFIG.adminLogin || idLower === 'admin@ufpb.br') &&
          senha === CONFIG.adminPass;

        if (isAdminMatch) {
          usuarioAutenticado = {
            id: 1,
            nome: CONFIG.adminName,
            email: CONFIG.adminEmail,
            usuario: CONFIG.adminLogin,
            siape: null,
            role: 'ADMIN',
            perfil: 'admin'
          };
          origem = 'GATEWAY';
        }
      }

      if (!usuarioAutenticado) {
        return enviarJson(res, 401, {
          error: 'Credenciais inválidas. Verifique seu E-mail/SIAPE/Usuário e senha.'
        });
      }

      const ssoToken = assinarTokenSso(usuarioAutenticado);

      return enviarJson(res, 200, {
        token: ssoToken,
        origem,
        usuario: usuarioAutenticado
      });
    }

    // 3. Validação da sessão SSO atual
    if (req.method === 'GET' && caminho === '/api/auth/me') {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : url.searchParams.get('token');
      const payload = verificarTokenSso(token);
      if (!payload) {
        return enviarJson(res, 401, { error: 'Sessão expirada ou inválida.' });
      }
      return enviarJson(res, 200, { usuario: payload, token });
    }

    // 4. Redirecionamento SSO direto para um sistema (/ir/:sistema?token=...)
    if (req.method === 'GET' && caminho.startsWith('/ir/')) {
      const sistemaId = caminho.slice(4).toLowerCase();
      const token = url.searchParams.get('token') || '';
      const payload = verificarTokenSso(token);
      if (!payload) {
        res.writeHead(302, { Location: '/?erro=sessao_expirada' });
        return res.end();
      }
      // Re-emite token fresco para o handoff
      const freshToken = assinarTokenSso({
        id: payload.id,
        nome: payload.nome,
        email: payload.email,
        usuario: payload.usuario,
        siape: payload.siape,
        docente_id: payload.docente_id,
        role: payload.role,
        perfil: payload.perfil
      });

      const destinos = {
        spd: `${CONFIG.spdUrl}/?sso_token=${encodeURIComponent(freshToken)}`,
        ed: `${CONFIG.edUrl}/api/sso?token=${encodeURIComponent(freshToken)}`,
        ets: `${CONFIG.etsUrl}/sso/login?token=${encodeURIComponent(freshToken)}`
      };

      const destino = destinos[sistemaId];
      if (!destino) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Sistema não encontrado');
      }

      res.writeHead(302, { Location: destino });
      return res.end();
    }

    // 5. Servir arquivos estáticos da pasta public/
    let relativo = caminho === '/' ? 'index.html' : decodeURIComponent(caminho).replace(/^\/+/, '');
    const arquivo = resolve(PUBLICO, relativo);
    const tipo = TIPOS_ARQUIVO[extname(arquivo).toLowerCase()];

    try {
      if (!relativo || relativo.includes('\0') || !arquivo.startsWith(PUBLICO + sep) || !tipo) {
        throw new Error('Arquivo inválido');
      }
      const info = await stat(arquivo);
      if (!info.isFile()) throw new Error('Não é arquivo');
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        'Content-Type': tipo,
        'Content-Length': conteudo.length,
        'Cache-Control': 'no-cache'
      });
      res.end(conteudo);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Página não encontrada');
    }
  });
}

// Inicia o servidor se executado diretamente
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const servidor = criarServidorGateway();
  servidor.listen(CONFIG.porta, CONFIG.host, () => {
    console.log(`Portal Gateway Unificado (SSO) rodando em http://localhost:${CONFIG.porta}`);
    console.log(`  -> SPD:         ${CONFIG.spdUrl}`);
    console.log(`  -> ED:          ${CONFIG.edUrl}`);
    console.log(`  -> Sistema-ETS: ${CONFIG.etsUrl}`);
  });
}
