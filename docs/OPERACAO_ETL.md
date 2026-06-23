# Operação permanente do ETL e alertas Telegram

## Arquitetura recomendada

O `docker-compose.yml` usa contêineres Linux. Portanto, ele exige Docker Desktop
em modo Linux/WSL 2 ou um host Docker Linux.

O servidor SiAGRI inspecionado usa Docker Engine nativo do Windows e imagens
`windowsservercore` com isolamento `process`. Esse engine não executa as imagens
Linux usadas por PostgreSQL e pelo ActionAPI. Nesse servidor, o modo suportado é
manter o ETL como tarefa Windows permanente. Uma migração integral para
contêineres exige um host ou VM Linux separado; não se deve alterar o engine
SiAGRI existente.

O Compose agora:

- força `PG_HOST=postgres` dentro dos contêineres;
- reinicia API e ETL automaticamente;
- possui health checks e rotação de logs;
- executa os jobs críticos quando o ETL inicia;
- mantém PostgreSQL restrito ao endereço configurado em `PG_BIND_HOST`.

Para iniciar:

```powershell
.\scripts\docker-actionapi.ps1 up
.\scripts\docker-actionapi.ps1 status
.\scripts\docker-actionapi.ps1 logs
```

O Compose central em `C:\OnPremise` é exclusivo dos serviços Windows do SiAGRI.
Não acrescente nele os serviços Linux deste repositório. Se futuramente houver
um host Docker Linux, preserve o banco PostgreSQL atual ou planeje formalmente a
migração do volume; não crie silenciosamente um segundo banco.

## Fallback como tarefa permanente do Windows

Quando Docker Desktop/Compose não estiver disponível:

```powershell
.\scripts\windows\instalar-tarefa-etl.ps1
```

Executado como administrador, instala uma tarefa `SYSTEM` no boot. Sem elevação,
instala uma tarefa no logon do usuário atual. O processo é reiniciado após falhas
e grava logs em `logs\etl-service.log`.

Quando migrar definitivamente para Docker, remova o fallback para não executar
dois schedulers:

```powershell
.\scripts\windows\remover-tarefa-etl.ps1
```

## Configuração do Telegram

1. No Telegram, converse com `@BotFather`.
2. Execute `/newbot`, defina nome e username e copie o token.
3. Envie uma mensagem para o bot criado.
4. Abra no navegador:

   `https://api.telegram.org/bot<TOKEN>/getUpdates`

5. Copie `message.chat.id`. Para grupos, adicione o bot ao grupo, envie uma
   mensagem e use o `chat.id` negativo retornado.
6. Preencha no `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:token
TELEGRAM_CHAT_ID=123456789
# Opcional, se o grupo usa tópicos:
TELEGRAM_MESSAGE_THREAD_ID=
```

Teste:

```powershell
cd packages\etl
npm run telegram:testar
```

O token é segredo e não deve ser versionado.

Como alternativa, este assistente valida o token, encontra os chats, atualiza o
`.env`, envia o teste e reinicia a tarefa do ETL:

```powershell
.\scripts\configurar-telegram.ps1
```

## Proteções implementadas

- Sobreposição incremental padrão de 48 horas
  (`ETL_INCREMENTAL_OVERLAP_MINUTES=2880`).
- Limite superior capturado do relógio Oracle antes da consulta.
- UPSERT idempotente, permitindo reler a janela sem duplicar.
- Cursor atualizado somente após sucesso e nunca por backfills/reconciliações.
- Reconciliação diária dos últimos 30 dias às 02:20.
- Jobs horários distribuídos em minutos diferentes.
- Atualização da camada analytics isolada no minuto 55; uma falha analítica não
  interrompe nem marca como falha a captura raw.
- Bloqueio contra duas execuções simultâneas do mesmo job.
- Registro persistente em `etl_job_status`.
- Alertas Telegram para erro e atraso, com mensagem de recuperação.

## Comandos de operação

Sincronizar baixas e recalcular saldos imediatamente:

```powershell
cd packages\etl
npm run financeiro:sincronizar-agora
```

Verificar a saúde usada pelo Docker:

```powershell
cd packages\etl
npm run healthcheck
```

As tabelas de monitoramento são criadas automaticamente pelo ETL. A definição
também está em `migrations/015_etl_monitoring.sql`.
