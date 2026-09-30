# LikeSystem

Site dark em 3D para venda e envio de likes (Free Fire), com login fechado, estoque individual por cliente e estoque global da API.

## Regras de negócio

| Regra | Valor |
| --- | --- |
| Preço | **R$ 8,80 a cada 2.000 likes** |
| Compra mínima (estoque individual) | **20.000 likes** (múltiplos de 2.000) |
| Envio | pede **ID do jogador + quantidade** (1 a 2.000 por envio) |
| Limite diário | **até 2.000 likes por dia em cada ID** (fuso America/Sao_Paulo) |
| Login admin | usuário **ADMIN**, senha **LELEO** |

- **Plataforma fechada:** só entra quem o admin cria ou aprova. Quem pede acesso fica "pendente" e não consegue logar.
- **Estoque individual:** saldo de likes de cada cliente. É debitado no envio e estornado automaticamente se a API falhar (ou se ela enviar menos que o pedido).
- **Estoque global:** saldo real da conta na API (`/api/balance`). O admin vê global, alocado aos clientes e livre para vender; ao aprovar um pedido maior que o livre, o painel avisa.
- **Pedidos:** o cliente gera o pedido e vê a chave PIX configurada pelo admin; o admin aprova após o pagamento e o estoque é creditado.

## Rodando

```bash
npm install
cp .env.example .env      # coloque sua LIKESYSTEM_API_KEY
npm start                 # http://localhost:3000
```

Para testar sem gastar likes reais: `npm run mock` (simula a API).

Requer Node 18.17+. Os dados ficam em `data/db.json` (usuários, sessões, pedidos, envios) — faça backup dessa pasta.

## Segurança

- A **API Key nunca vai para o navegador**: todas as chamadas à API passam pelo servidor.
- Senhas com `scrypt` + salt; sessão em cookie `HttpOnly; SameSite=Strict`; rotas que alteram dados só aceitam JSON.
- Bloqueio de 10 min após 5 tentativas de login erradas.
- Em produção com HTTPS, use `SECURE_COOKIES=1`. Para trocar a senha do admin, defina `ADMIN_PASSWORD`.

## O traje 3D

A entrada tem um traje ninja laranja e preto (jaqueta com gola alta, zíper, espiral nas costas e no ombro, bandana com placa metálica e uma esfera de chakra) “vestido” por um shinobi invisível. Ele é **100% procedural** em Three.js — tecido com mapa de normal em sarja, sombreamento de cavidade nas dobras, barra que balança, sombras, bloom e partículas — e **gira/muda de posição conforme a rolagem, o mouse e a troca de telas no painel**.

**Ultra realismo com modelo escaneado:** coloque um arquivo `public/models/outfit.glb` (ex.: um traje fotogramétrico/licenciado) e ele substitui o procedural automaticamente, mantendo todos os movimentos.

## Estrutura

```
server.js            rotas (auth, envios, pedidos, admin)
src/config.js        regras e variáveis de ambiente
src/likeapi.js       cliente da API LikeSystem (+ modo simulado)
src/auth.js          senhas, sessões, proteção de login
src/db.js            banco JSON com escrita atômica
public/index.html    landing 3D + login
public/app.html      painel do cliente e do admin
public/js/scene.js   cena 3D do traje
```
