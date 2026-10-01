# Like2k

Loja de **likes 2K para Free Fire**: o cliente digita o ID, escolhe o plano, paga no PIX e recebe **2.000 likes automaticamente**. Sem cadastro, sem senha. Painel admin em `/admin`.

## O que tem

- **Loja pública** (`/`): verificação do ID (mostra o nick antes de cobrar), planos, PIX com QR Code e copia-e-cola, página do pedido que atualiza sozinha.
- **Envio automático**: assim que o PIX cai (webhook do Mercado Pago + consulta a cada 15 s), o primeiro envio sai na hora. Planos por dias agendam **2.000 likes por dia**, sempre no horário do pagamento.
- **Limite do jogo respeitado**: cada ID recebe no máximo 2.000 likes por dia (horário de Brasília). Se o limite já foi usado, o envio passa para o dia seguinte sozinho.
- **Falhas com retentativa**: a API de likes falhou? Tenta de novo a cada 10 min (até 12x); depois fica "Falhou" para o admin reenviar com um clique.
- **Painel admin** (`/admin`): vendas de hoje e totais, gráfico de 14 dias, saldo da API, pedidos (confirmar pagamento manual, cancelar), envios (reenviar, enviar agora, cancelar), envio manual de likes e configurações (nome do site, WhatsApp, aviso, planos e preços).
- **Modo simulado** (`npm run mock`): API de likes e PIX fictícios, com botão "Simular pagamento" na página do pedido. Ideal para testar antes de colocar as chaves.

## Planos padrão (editáveis no painel)

| Plano | Likes | Preço |
| --- | --- | --- |
| 2K Likes | 2.000 (uma vez) | R$ 9,90 |
| 2K por dia · 7 dias | 14.000 | R$ 49,90 |
| 2K por dia · 30 dias | 60.000 | R$ 149,90 |

## Rodando

```bash
npm install
cp .env.example .env    # coloque LIKE_API_KEY e MP_ACCESS_TOKEN
npm start               # http://localhost:3000
```

Testar sem chaves: `npm run mock`. Requer Node 18.17+. Os dados ficam em `data/db.json` (pedidos, envios, configurações). Faça backup dessa pasta.

Login do painel: usuário `ADMIN`, senha `LELEO` (troque com `ADMIN_USER` / `ADMIN_PASSWORD` no `.env`).

### Square Cloud

O arquivo `squarecloud.app` já está pronto. Suba o projeto (sem `node_modules`), configure as variáveis do `.env` no painel da Square e use o domínio gerado como `PUBLIC_URL`.

## Configurando

### API de likes

`LIKE_API_URL` e `LIKE_API_KEY`: API no formato LikeSystem (`POST /api/likes/send` com `target_id` e `amount`, `GET /api/balance`, `GET /api/player/{uid}`), autenticada pelo header `X-Api-Key`. A chave nunca vai para o navegador.

### PIX (Mercado Pago)

1. Em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) crie um aplicativo e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`.
2. Em **Webhooks**, cadastre `https://SEU-DOMINIO/webhooks/mercadopago` com o evento *Pagamentos* e copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.
3. `PUBLIC_URL` precisa ser o endereço **https** público do site (o Mercado Pago só chama webhooks https). Sem webhook o site ainda funciona: ele consulta os PIX pendentes a cada 15 s.
4. Em produção, use `SECURE_COOKIES=1`.

O PIX expira em 30 minutos. Pedidos não pagos ficam como "Expirado" e podem ser confirmados manualmente pelo admin se o cliente pagar depois.

## Estrutura

```
server.js            rotas (loja, webhook, painel)
src/config.js        variáveis de ambiente e regras (2.000 likes/dia)
src/db.js            banco JSON com escrita atômica
src/auth.js          login do admin, sessão, proteção contra força bruta
src/likeapi.js       cliente da API de likes (+ modo simulado)
src/payments.js      PIX no Mercado Pago (+ modo simulado)
src/orders.js        pedidos, fila de envios diários, retentativas, rotina de fundo
public/index.html    loja
public/pedido.html   página do pedido (/pedido/CODIGO)
public/admin.html    painel (/admin)
```

## API da loja

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/config` | Nome, planos ativos, WhatsApp, aviso |
| GET | `/api/player/{uid}` | Nick, nível, likes do perfil e quanto ainda cabe hoje |
| POST | `/api/orders` | `{ uid, planId, contact? }` → cria pedido e PIX |
| GET | `/api/orders/{codigo}` | Status do pedido e envios (`?sync=1` consulta o PIX na hora) |
| POST | `/webhooks/mercadopago` | Notificação do Mercado Pago (assinatura validada) |

## Segurança

- Chaves só no servidor; o navegador nunca vê a API Key nem o Access Token.
- Sessão do admin em cookie `HttpOnly; SameSite=Strict`; alterações só em JSON (bloqueia CSRF).
- Bloqueio de 10 min após 5 senhas erradas; limite de requisições por IP na verificação de ID e na criação de pedidos.
- Código do pedido aleatório (10 caracteres): só quem tem o link acompanha.
