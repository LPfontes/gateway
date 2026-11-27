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

function urlDoSistema(sys) {
  return sys.url || '#';
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
      const hrefDireto = urlDoSistema(sys);

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
            <a class="gw-btn-launch" href="${escapeHtml(hrefDireto)}">
              Acessar ${escapeHtml(sys.sigla)} &rarr;
            </a>
          </div>
        </article>
      `;
    })
    .join('');
}

const btnRefresh = byId('btnRefreshStatus');
if (btnRefresh) {
  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = 'Verificando...';
    await carregarSistemas();
    btnRefresh.disabled = false;
    btnRefresh.textContent = 'Atualizar Status dos Servidores';
  });
}

// Inicialização
inicializarTema();
carregarSistemas();
