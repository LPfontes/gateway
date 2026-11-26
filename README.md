# Portal Gateway Unificado (SSO) • SPD · ED · Sistema-ETS

Repositório orquestrador do **Portal Gateway Unificado (Single Sign-On)** que integra os **3 sistemas acadêmicos independentes** da UFPB via **Git Submodules** e sobe toda a arquitetura com um único **`docker compose up --build`**.

## Repositórios Integrados (Submódulos)

1. **[SPD](./SPD)** (`https://github.com/LPfontes/SPD`) — *Sistema de Presença Docente* (Node.js/Express + React/Vite + PostgreSQL)
2. **[ed](./ed)** (`https://github.com/LPfontes/ed`) — *Encargos Docentes* (Node.js 22 + SQLite nativo)
3. **[Sistema-ets](./Sistema-ets)** (`https://github.com/LPfontes/Sistema-ets`) — *Análise de Cargas Horárias de Cursos ETS/UFPB* (PHP 8.2 / Laravel 12 + MariaDB)

---

## Como Clonar com os 3 Sistemas

```bash
git clone --recurse-submodules https://github.com/LPfontes/gateway.git
cd gateway
```

Caso já tenha clonado sem `--recurse-submodules`, inicialize os submódulos com:

```bash
git submodule update --init --recursive
```

---

## Subindo Todos os Sistemas Independentes com Docker

```bash
docker compose up -d --build
```

### Portas e Serviços Independentes

| Serviço | Container | Porta Local | Banco de Dados Independente |
| :--- | :--- | :--- | :--- |
| **Portal Gateway (SSO)** | `ufpb_gateway` | `http://localhost:4000` | Stateless (Token HMAC-SHA256) |
| **SPD** | `ufpb_spd_app` | `http://localhost:3000` | `ufpb_spd_postgres` (PostgreSQL 16) |
| **ED** | `ufpb_ed_app` | `http://localhost:3001` | Volume isolado `ed_data` (SQLite) |
| **Sistema-ETS** | `ufpb_ets_app` | `http://localhost:8000` | `ufpb_ets_mariadb` (MariaDB 10.11) |

---

## Funcionamento do Login Unificado (Single Sign-On)

1. Acesse o **Portal Gateway** em `http://localhost:4000`.
2. Faça login uma única vez usando seu **E-mail**, **SIAPE** ou **Usuário** (padrão de administrador inicial: `admin@spd.local` / senha `admin123`).
3. O Gateway emite um token SSO assinado (`SSO_SECRET`) compartilhado com os 3 sistemas:
   - **SPD**: recebe via `/?sso_token=<token>`
   - **ED**: recebe via `/api/sso?token=<token>`
   - **Sistema-ETS**: recebe via `/sso/login?token=<token>`
