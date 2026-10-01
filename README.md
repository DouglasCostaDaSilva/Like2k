# Like2k

**Source de likes do Free Fire + site de acompanhamento.**

- `api/` — a source: API em Python (Flask) que envia likes para um perfil usando um pool de contas por região. Endpoint `/like?uid=...&server_name=BR&key=...`.
- raiz — o site (Node, sem dependências nativas): o jogador consulta o ID, vê nick e likes atuais, pede likes com um clique e acompanha o histórico (antes → depois). Painel `/admin` com status da API por região, envios e configurações.

```
api/app.py             API de likes (source) — rotas /like, /info, /status, /reset-limit
api/account_*.txt      contas por região (UID:SENHA, uma por linha) — NÃO vão para o git
server.js              rotas do site (consulta, envio, painel)
src/likeapi.js         cliente da API (+ modo simulado)
src/sends.js           histórico de envios (antes/depois, 1x por dia por ID)
public/index.html      site de acompanhamento
public/admin.html      painel
```

## 1. Subindo a API (source)

```bash
cd api
pip install -r requirements.txt
# crie os arquivos de contas (um UID:SENHA por linha):
#   account_br.txt  account_ind.txt  account_bd.txt  account_ru.txt
API_KEY=SUA_CHAVE PORT=5001 python app.py
```

- `API_KEY`: chave exigida em todas as rotas (padrão da source: `DRIFT`). Troque.
- `KEY_LIMIT`: envios por dia por IP (padrão 100).
- Os tokens das contas são renovados sozinhos a cada 30 min e salvos em `token_*.json`.
- Regiões: `IND`, `BR`, `US`, `SAC`, `NA`, `BD`, `RU`. BR/US/SAC/NA usam `account_br.txt`.

Rotas:

| Rota | O que faz |
| --- | --- |
| `GET /like?uid=&server_name=&key=` | Envia likes. Devolve `LikesbeforeCommand`, `LikesafterCommand`, `LikesGivenByAPI`, `PlayerNickname`, `tokens_used`, `remains` |
| `GET /info?uid=&server_name=&key=` | Só consulta: nick, likes atuais, nível (adicionado para o site) |
| `GET /status?key=` | Contas e tokens válidos por região, limite restante, uptime (adicionado para o site) |
| `GET /reset-limit?key=` | Zera o limite diário do IP |

Documentação original da source em `api/README.md`.

## 2. Subindo o site

```bash
npm install
cp .env.example .env     # LIKE_API_URL = onde a API está, LIKE_API_KEY = mesma API_KEY
npm start                # http://localhost:3000
```

Testar o site sem a API: `npm run mock` (likes e perfis simulados).

Login do painel: `ADMIN` / `LELEO` (troque com `ADMIN_USER` / `ADMIN_PASSWORD`). Dados em `data/db.json`.

### Square Cloud

Dois apps: a pasta `api/` (tem `squarecloud.app` próprio, `MAIN=app.py`) e a raiz (site, `MAIN=server.js`). No site, aponte `LIKE_API_URL` para o domínio da API.

## O que o site faz

- **Consulta** (`/`): ID + região → nick, likes agora, total recebido pelo site e se já recebeu hoje.
- **Receber likes**: botão no próprio resultado (pode ser desligado no painel). Um envio por dia por ID; o resultado mostra `+N`, antes → depois.
- **Histórico** por ID: cada envio com data, região, antes, depois e likes dados.
- **Painel** (`/admin`): likes enviados hoje/total, IDs atendidos, gráfico de 14 dias, status da API (online, uptime, tokens em cache, limite restante) e saúde por região (contas × tokens válidos), lista de envios com filtros, envio manual, zerar limite da API, configurações (nome, WhatsApp, aviso, envio público, regiões ativas e padrão).

## Segurança

- A chave da API fica só no servidor do site; o navegador nunca a vê.
- Contas (`account_*.txt`) e tokens (`token_*.json`) ficam fora do git (`api/.gitignore`).
- Sessão do admin em cookie `HttpOnly; SameSite=Strict`; alterações só em JSON; bloqueio após 5 senhas erradas; limite de requisições por IP na consulta e no envio.
