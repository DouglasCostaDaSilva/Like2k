# Zyropay

Gateway de pagamentos PIX. Lojistas se cadastram, geram cobranças pelo painel ou pela API, mandam um link de pagamento pronto e recebem aviso por webhook quando o PIX cai. O PIX é processado pelo **Mercado Pago**; o Zyropay controla saldo, taxa e saques de cada lojista.

## Taxa

**2% por PIX pago, mínimo de R$ 0,30.** A taxa é descontada na hora em que a cobrança é paga (`net_amount = amount − fee`). Cobranças expiradas ou canceladas não pagam taxa. O admin pode definir percentual e mínimo diferentes por lojista.

## Como funciona

1. **Cadastro:** o lojista cria conta com CPF/CNPJ (validado). A conta fica *em análise* até o admin aprovar.
2. **Cobrança:** pelo painel ou `POST /v1/charges`. O Zyropay cria o pagamento PIX no Mercado Pago e devolve QR Code, copia e cola e `checkout_url`.
3. **Pagamento:** o cliente paga pela página `/pay/{id}`, que atualiza sozinha. O Zyropay fica sabendo pelo webhook do Mercado Pago e, como garantia, consulta as cobranças pendentes a cada 15 s.
4. **Aviso:** o sistema do lojista recebe `charge.paid` no webhook dele, assinado com HMAC-SHA256 (`Zyropay-Signature`), com até 6 tentativas.
5. **Saque:** o lojista pede saque para a chave PIX dele; o admin faz o PIX e marca como pago (ou recusa, e o valor volta ao saldo).

## Rodando

```bash
npm install
cp .env.example .env    # preencha MP_ACCESS_TOKEN e PUBLIC_URL
npm start               # http://localhost:3000
```

Teste sem Mercado Pago: `npm run mock`. Aparece o botão “Simular pagamento” no painel e no checkout.

Admin: usuário `ADMIN`, senha `LELEO` (mude com `ADMIN_USER` / `ADMIN_PASSWORD`).

## Configurando o Mercado Pago

1. Em **Suas integrações › Credenciais de produção**, copie o *Access Token* para `MP_ACCESS_TOKEN`.
2. `PUBLIC_URL` precisa ser o endereço **https** público do Zyropay (o Mercado Pago só notifica URLs https).
3. Em **Webhooks**, cadastre `https://SEU-DOMINIO/webhooks/mercadopago`, evento *Pagamentos*, e copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
4. Em produção, use `SECURE_COOKIES=1`.

O dinheiro dos PIX cai na conta Mercado Pago dona do token. Os saques aos lojistas saem dessa conta (feitos pelo admin).

## API

Documentação completa em `/docs`. Resumo:

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/v1/charges` | Cria cobrança (`amount` em centavos, `Idempotency-Key` opcional) |
| GET | `/v1/charges/{id}` | Consulta (aceita também o `external_id`) |
| GET | `/v1/charges` | Lista |
| POST | `/v1/charges/{id}/cancel` | Cancela pendente |
| GET | `/v1/balance` | Saldo |

Autenticação: `Authorization: Bearer zp_live_…` (a chave é guardada só como hash).

## Estrutura

```
server.js             rotas: autenticação, painel, API v1, webhooks, admin
src/config.js         variáveis de ambiente e cálculo da taxa
src/mercadopago.js    provedor PIX (Mercado Pago) + provedor simulado
src/webhooks.js       envio assinado e reenvio dos avisos aos lojistas
src/auth.js           senhas (scrypt), sessões, chaves de API
src/db.js             banco em arquivo JSON (data/zyropay.json)
public/               página inicial, entrar/cadastro, painel, checkout e docs
```

## Antes de operar com dinheiro de terceiros

- **Banco de dados:** o JSON em disco funciona para começar, mas para volume real migre para Postgres e faça backup diário.
- **Regulação:** receber dinheiro em nome de outras empresas e repassar (subcredenciamento) é atividade regulada pelo Banco Central. Confirme com um contador ou advogado o enquadramento e os termos de uso do Mercado Pago para esse modelo.
- **Contestação e golpes:** defina regras de análise de cadastro (KYC) e um prazo de retenção de saldo se o seu público tiver risco de fraude.
