'use strict';

const STORAGE_TOKEN = 'ufpb_gateway_sso_token';
const STORAGE_USER = 'ufpb_gateway_sso_user';
const STORAGE_ORIGIN = 'ufpb_gateway_sso_origin';
const STORAGE_THEME = 'ufpb_gateway_theme';

const byId = id => document.getElementById(id);
const escapeHtml = str =>
  String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let state = {
  token: localStorage.getItem(STORAGE_TOKEN) || null,
  usuario: (() => {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })(),
  origem: localStorage.getItem(STORAGE_ORIGIN) || 'SSO',
  sistemas: []
};

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem(STORAGE_THEME, tema);
  const btn = byId('btnThemeToggle');
  if (btn) btn.textContent = tema === 'dark' ? 'Modo Claro' : 'Modo Escuro';
}

function inicializarTema() {
  const salvo = localStorage.getItem(STORAGE_THEME) || 'light';
  aplicarTema(salvo);
  byId('btnThemeToggle').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme') || 'light';
    aplicarTema(atual === 'dark' ? 'light' : 'dark');
  });
}

async function carregarSistemas() {
  try {
    const res = await fetch('/api/sistemas');
    const data = await res.json();
    if (Array.isArray(data.sistemas)) {
      state.sistemas = data.sistemas;
      renderizarSistemas();
    }
  } catch (err) {
    console.warn('Falha ao consultar status dos sistemas:', err);
  }
}

function linkSsoDoSistema(sistemaId) {
  if (!state.token) return '#';
  return `/ir/${encodeURIComponent(sistemaId)}?token=${encodeURIComponent(state.token)}`;
}

function renderizarSistemas() {
  const grid = byId('systemsGrid');
  if (!grid) return;

  grid.innerHTML = state.sistemas
    .map(sys => {
      const online = Boolean(sys.status?.online);
      const statusTexto = online
        ? `Online (${sys.status.latenciaMs ?? '<1'} ms)`
        : 'Servidor Offline';
      const statusClasse = online ? 'online' : 'offline';
      const tagsHtml = (sys.tags || [])
        .map(t => `<span class="gw-tag">${escapeHtml(t)}</span>`)
        .join('');
      const hrefSso = linkSsoDoSistema(sys.id);

      return `
        <article class="gw-system-card" data-system="${escapeHtml(sys.id)}">
          <div>
            <div class="gw-card-top">
              <span class="gw-card-sigla" style="background:${escapeHtml(sys.cor || '#14213d')}">${escapeHtml(sys.sigla)}</span>
              <span class="gw-status-pill ${statusClasse}">
                <span class="gw-status-pill-dot"></span>
                ${escapeHtml(statusTexto)}
              </span>
            </div>
            <h3 class="gw-card-title">${escapeHtml(sys.nome)}</h3>
            <span class="gw-card-subtitle">${escapeHtml(sys.subtitulo)}</span>
            <p class="gw-card-desc">${escapeHtml(sys.descricao)}</p>
          </div>

          <div class="gw-card-actions">
            <a class="gw-btn-launch" href="${escapeHtml(hrefSso)}">
              Entrar no ${escapeHtml(sys.sigla)} com SSO &rarr;
            </a>
          </div>
        </article>
      `;
    })
    .join('');
}

function atualizarInterfaceAutenticada() {
  const autenticado = Boolean(state.token && state.usuario);
  byId('loginView').hidden = autenticado;
  byId('hubView').hidden = !autenticado;
  byId('userChip').hidden = !autenticado;

  if (autenticado) {
    const u = state.usuario;
    const isAdmin = u.role === 'ADMIN' || u.perfil === 'admin';
    byId('userNameLabel').textContent = u.nome || u.usuario || u.email;
    byId('userEmailLabel').textContent = u.email || u.usuario || '';
    byId('userRoleBadge').textContent = isAdmin ? 'Administrador' : 'Docente / Visitante';

    if (byId('metaNome')) byId('metaNome').textContent = u.nome || '—';
    if (byId('metaEmail')) byId('metaEmail').textContent = u.email || '—';
    if (byId('metaUsuario')) byId('metaUsuario').textContent = u.siape || u.usuario || '—';
    if (byId('metaPerfil')) byId('metaPerfil').textContent = isAdmin ? 'Administrador (Acesso Total)' : 'Docente / Visitante (Consulta)';
    if (byId('ssoOriginBadge')) byId('ssoOriginBadge').textContent = `Credencial validada (${state.origem || 'SSO'})`;

    renderizarSistemas();
  }
}

function encerrarSessao() {
  state.token = null;
  state.usuario = null;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_ORIGIN);
  atualizarInterfaceAutenticada();
}

async function verificarSessaoExistente() {
  if (!state.token) {
    atualizarInterfaceAutenticada();
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!res.ok) {
      encerrarSessao();
      return;
    }
    const data = await res.json();
    state.usuario = data.usuario;
    atualizarInterfaceAutenticada();
  } catch {
    atualizarInterfaceAutenticada();
  }
}

byId('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const erroEl = byId('loginError');
  const btn = byId('btnSubmitLogin');
  erroEl.hidden = true;

  const identificador = byId('inputIdentificador').value.trim();
  const senha = byId('inputSenha').value;
  const destino = byId('selectDestinoInicial').value;

  if (!identificador || !senha) {
    erroEl.textContent = 'Preencha seu identificador (E-mail, SIAPE ou Usuário) e sua senha.';
    erroEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Autenticando nos sistemas...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador, senha })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Credenciais inválidas.');
    }

    state.token = data.token;
    state.usuario = data.usuario;
    state.origem = data.origem || 'SSO';

    localStorage.setItem(STORAGE_TOKEN, state.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(state.usuario));
    localStorage.setItem(STORAGE_ORIGIN, state.origem);

    // Se o usuário escolheu ir direto para um sistema específico
    if (destino && destino !== 'hub') {
      window.location.href = linkSsoDoSistema(destino);
      return;
    }

    byId('loginForm').reset();
    atualizarInterfaceAutenticada();
    await carregarSistemas();
  } catch (err) {
    erroEl.textContent = err.message || 'Falha ao autenticar no Gateway.';
    erroEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar com Login Unificado';
  }
});

byId('btnLogout').addEventListener('click', () => {
  encerrarSessao();
});

byId('btnRefreshStatus').addEventListener('click', async () => {
  const btn = byId('btnRefreshStatus');
  btn.disabled = true;
  btn.textContent = 'Verificando...';
  await carregarSistemas();
  btn.disabled = false;
  btn.textContent = 'Atualizar Status dos Servidores';
});

// Inicialização
inicializarTema();
verificarSessaoExistente();
carregarSistemas();
