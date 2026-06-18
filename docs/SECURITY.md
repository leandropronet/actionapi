# Segurança da ActionAPI

## Controles implementados

- API key obrigatória para integrações;
- comparação de chaves em tempo constante;
- sessão administrativa JWT em cookie `HttpOnly`, `SameSite=Strict` e `Secure`;
- senha administrativa armazenada somente como hash `scrypt`;
- rate limit global e limite mais restrito no login;
- headers de segurança via Helmet;
- Content Security Policy;
- limite de tamanho do corpo das requisições;
- auditoria de acesso por rota, status, IP e identidade anonimizada da chave;
- Swagger e painel protegidos por login;
- container da API sem usuário root, filesystem somente leitura e
  `no-new-privileges`;
- PostgreSQL e API vinculados a `127.0.0.1` por padrão no Docker Compose;
- opção de rejeitar HTTP com `ENFORCE_HTTPS=true`;
- nenhuma rota de escrita no ERP;
- Oracle acessado exclusivamente pelo ETL com consultas.

## Implantação recomendada

```text
Usuário / integração
        │ HTTPS
        ▼
Reverse proxy (IIS, Nginx, Traefik)
        │ localhost:3000
        ▼
ActionAPI
        │ rede Docker privada
        ▼
PostgreSQL
```

Configuração recomendada:

```env
BIND_HOST=127.0.0.1
PG_BIND_HOST=127.0.0.1
TRUST_PROXY=true
ENFORCE_HTTPS=true
COOKIE_SECURE=true
```

O reverse proxy deve encaminhar corretamente `X-Forwarded-Proto: https`.

## Gestão de segredos

- nunca versionar `.env`;
- usar chaves aleatórias longas e distintas por consumidor;
- usar `SESSION_SECRET` aleatório com no mínimo 32 caracteres;
- rotacionar API keys removendo primeiro o consumidor antigo;
- não reutilizar a senha administrativa em outros sistemas;
- restringir leitura do `.env` à conta que executa os containers.

Exemplos para gerar segredos:

```powershell
# API key ou SESSION_SECRET
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

```bash
cd packages/api
npm run hash-password -- "senha-administrativa-forte"
```

## Limitações conhecidas

- existe um único perfil administrativo; não há RBAC por usuário;
- a auditoria é enviada aos logs da aplicação, não a um SIEM dedicado;
- TLS depende do reverse proxy e do certificado da infraestrutura;
- rate limit é por instância; múltiplas réplicas exigem armazenamento
  compartilhado, como Redis.
