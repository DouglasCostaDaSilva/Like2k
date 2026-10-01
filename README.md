# Zyropay

A camada de produto em cima do PIX do **Mercado Pago**: API, checkout hospedado, webhooks assinados e painel. Cada lojista **conecta a própria conta Mercado Pago** (OAuth, modelo marketplace) e o PIX **cai direto nela**. O Zyropay não recebe nem guarda dinheiro de ninguém: sua receita é a comissão por PIX pago, enviada como `application_fee`.

> Por que assim: receber e repassar dinheiro de terceiros em uma única conta é atividade regulada (subadquirência/instituição de pagamento) e costuma violar os termos de uso do provedor. No modelo marketplace o Mercado Pago é quem processa e liquida direto ao lojista.

## Taxa

**2% por PIX pago, mínimo de R$ 0,30**, enviada ao Mercado Pago como `application_fee` e descontada por ele na origem. Cobranças expiradas ou canceladas não pagam taxa. A tarifa do PIX do próprio Mercado Pago é cobrada por ele, à parte. O admin pode definir percentual e mínimo diferentes por lojista.

## Como funciona

1. **Cadastro:** o lojista cria conta com CPF/CNPJ (validado). Fica *em análise* até o admin aprovar.
2. **Conexão:** em Painel › Integração, o lojista autoriza o Zyropay na conta Mercado Pago dele (OAuth). Os tokens ficam criptografados (AES-256-GCM) e são renovados sozinhos.
3. **Cobrança:** pelo painel ou `POST /v1/charges`. O Zyropay cria o PIX **na conta do lojista** (token dele) com `application_fee` e devolve QR Code, copia e cola e `checkout_url`.
4. **Pagamento:** o cliente paga em `/pay/{id}`, que atualiza sozinha. O Zyropay sabe pelo webhook do Mercado Pago e, como garantia, consulta as cobranças pendentes a cada 15 s.
5. **Aviso:** o sistema do lojista recebe `charge.paid` no webhook dele, assinado com HMAC-SHA256 (`Zyropay-Signature`), com até 6 tentativas.
6. **Conciliação:** resumo em `GET /v1/summary` e exportação CSV no painel. Devoluções por `POST /v1/charges/{id}/refund` (saem da conta do lojista).

## Rodando

```bash
npm install
cp .env.example .env    # preencha MP_CLIENT_ID, MP_CLIENT_SECRET e PUBLIC_URL
npm start               # http://localhost:3000
```

Teste sem Mercado Pago: `npm run mock`. Aparece o botão “Simular pagamento” no painel e no checkout.

Admin: usuário `ADMIN`, senha `LELEO` (mude com `ADMIN_USER` / `ADMIN_PASSWORD`).

## Configurando o Mercado Pago

1. Em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) crie um **aplicativo** (conta do Zyropay, que recebe as comissões) com o modelo **Marketplace**/split de pagamentos.
2. Copie o *Client ID* (APP ID) para `MP_CLIENT_ID` e o *Client Secret* para `MP_CLIENT_SECRET`.
3. Em **Redirect URLs** do aplicativo, cadastre `https://SEU-DOMINIO/oauth/mercadopago/callback`. `PUBLIC_URL` precisa ser o endereço **https** público do Zyropay.
4. Em **Webhooks**, cadastre `https://SEU-DOMINIO/webhooks/mercadopago`, evento *Pagamentos*, e copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
5. Defina `ENCRYPTION_KEY` (qualquer texto longo e secreto) para criptografar os tokens dos lojistas. Sem ela uma chave é criada em `data/secret.key` (faça backup).
6. Em produção, use `SECURE_COOKIES=1`.

> Não consegui consultar a documentação do Mercado Pago neste ambiente: o fluxo OAuth e o `application_fee` seguem a API conhecida e foram testados contra um servidor falso. **Valide com uma conta real** (cobrança de R$ 1,00) antes de operar, inclusive a aprovação do aplicativo para split e as regras de comissão para PIX.

## API

Documentação completa (início rápido, autenticação, cobranças, saques, webhooks, erros e guias) em `/docs`. Resumo:

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/v1/charges` | Cria cobrança (`amount` em centavos, `Idempotency-Key` opcional) |
| GET | `/v1/charges/{id}` | Consulta (aceita também o `external_id`) |
| GET | `/v1/charges` | Lista (`limit`, `status`, `external_id`, `starting_after`) |
| POST | `/v1/charges/{id}/cancel` | Cancela pendente |
| POST | `/v1/charges/{id}/refund` | Devolve pagamento (sai da conta do lojista) |
| GET | `/v1/summary` | Resumo do período (cobranças, bruto, taxa, líquido) |
| GET | `/v1/account` | Dados da conta (serve para testar as credenciais) |

### Autenticação com duas credenciais

Toda chamada leva **Client ID** (`zp_id_…`, público) **e** **Client Secret** (`zp_sk_…`, privado), por HTTP Basic (`Authorization: Basic base64(id:secret)`) ou pelos headers `Zyropay-Client-Id` e `Zyropay-Client-Secret`.

- O Client ID é criado no cadastro; o Client Secret é gerado automaticamente na primeira visita a **Painel › Integração** e aparece **uma vez** (no banco fica só o hash SHA-256).
- O lojista gera novas credenciais quando quiser (pede a senha): só o secret, ou ID + secret, com carência opcional de 1 h / 24 h em que o secret antigo continua valendo. Também pode revogar o secret.
- 5 credenciais inválidas seguidas (mesmo IP e Client ID) bloqueiam novas tentativas por 10 min. Limite de 120 requisições por minuto por conta.
- Erros da API trazem `error`, `code` estável e `request_id`.

Rotas do painel: `GET/POST/DELETE /api/merchant/credentials`.

## Estrutura

```
server.js             rotas: autenticação, painel, API v1, webhooks, admin
src/config.js         variáveis de ambiente e cálculo da taxa
src/mercadopago.js    provedor PIX (Mercado Pago) + provedor simulado
src/webhooks.js       envio assinado e reenvio dos avisos aos lojistas
src/auth.js           senhas (scrypt), sessões, credenciais de API (Client ID + Secret)
src/db.js             banco em arquivo JSON (data/zyropay.json)
public/               landing page, entrar/cadastro, painel, checkout e documentação
                      (css/site.css e js/site.js compartilhados pela landing e pelos docs)
```

## Antes de operar

- **Dinheiro:** nunca passa pelo Zyropay. Se algum dia quiser custodiar saldo ou fazer saques, isso exige ser (ou operar sob) uma instituição de pagamento autorizada pelo Banco Central.
- **Banco de dados:** o JSON em disco funciona para começar, mas para volume real migre para Postgres e faça backup diário (inclua `data/secret.key` ou a `ENCRYPTION_KEY`).
- **Termos do Mercado Pago:** confirme com eles as regras do modelo marketplace/split e das comissões sobre PIX.
- **Contestação e golpes:** defina regras de análise de cadastro (KYC) para o seu público.
