# Guia de uso da ActionAPI

## Acessos disponíveis

| Endereço | Finalidade | Autenticação |
|---|---|---|
| `/login` | Login administrativo | Usuário e senha |
| `/painel` | Consultas visuais somente leitura | Sessão administrativa |
| `/docs` | Swagger/OpenAPI interativo | Sessão administrativa |
| `/api/v1/*` | Integrações e consultas JSON | `X-API-Key` ou sessão |
| `/health` | Disponibilidade do serviço | Público, com rate limit |

## Integração por API key

Envie a chave em todas as requisições:

```http
X-API-Key: sua-chave
```

Exemplo:

```bash
curl \
  -H "X-API-Key: sua-chave" \
  "https://api.exemplo.local/api/v1/faturamento/resumo?paramId=102&dataInicio=2025-01-01&dataFim=2025-12-31"
```

As chaves são configuradas no servidor:

```env
API_KEYS=chave-do-bi,chave-do-integrador
```

É recomendável usar uma chave diferente por sistema consumidor. Os logs registram
um identificador irreversível da chave, nunca a chave em texto.

## Login administrativo

O painel e o Swagger não expõem a API key no navegador. Após o login, o servidor
cria uma sessão JWT em cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` quando `COOKIE_SECURE=true`;
- expiração definida por `SESSION_TTL_SECONDS`.

Para gerar o hash da senha:

```bash
cd packages/api
npm run hash-password -- "uma-senha-longa-e-exclusiva"
```

Copie o resultado completo para `ADMIN_PASSWORD_HASH` no `.env`.

## Swagger

Depois do login, abra `/docs`. A tela permite:

- consultar todas as rotas e filtros;
- executar requisições;
- visualizar parâmetros e respostas;
- informar uma API key pelo botão **Authorize**, se desejar testar como integração.

## Painel

O painel em `/painel` contém:

- consolidado de faturamento por período, parâmetro e filial;
- detalhamento do resultado por filial;
- explorador de notas, entradas, devoluções, pedidos, duplicatas, estoque,
  lotes, clientes e contabilidade;
- acesso direto à documentação Swagger.

O painel é estritamente de consulta. Não existem rotas `POST`, `PUT`, `PATCH` ou
`DELETE` para dados do ERP.

## Faturamento consolidado

```http
GET /api/v1/faturamento/resumo
```

Parâmetros principais:

| Parâmetro | Exemplo | Descrição |
|---|---|---|
| `paramId` | `102` | Ativa o consolidado pelas funções A/S |
| `dataInicio` | `2025-01-01` | Emissão inicial |
| `dataFim` | `2025-12-31` | Emissão final |
| `filialId` | `1` | Opcional |
| `status` | `5` | Status da nota; padrão 5 |

O parâmetro 102 reproduz o relatório **Saídas Faturadas - Analítico** combinando:

1. `NOTA`: `TOTA_NOT`, conforme função A/S;
2. `NFENTRA`: `QUAN_INF × VLIQ_INF`, conforme função A/S.

## Respostas e erros

Lista paginada:

```json
{
  "data": [],
  "total": 100,
  "page": 1,
  "pageSize": 100
}
```

Erro:

```json
{
  "error": "Descrição do erro",
  "code": "CODIGO_DO_ERRO"
}
```

Status mais comuns:

| HTTP | Significado |
|---|---|
| `200` | Consulta concluída |
| `400` | Filtros inválidos |
| `401` | Autenticação ausente ou inválida |
| `404` | Registro ou rota inexistente |
| `426` | HTTPS obrigatório |
| `429` | Limite de requisições excedido |
| `500` | Erro interno |

O catálogo completo e sempre executável está disponível em `/docs`.
