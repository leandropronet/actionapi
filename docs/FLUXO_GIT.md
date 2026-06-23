# Fluxo Git — como enviar alterações para o GitHub

## Configuração atual do repositório

- Remoto: `git@github.com:leandropronet/actionapi.git` (SSH, não HTTPS).
- Branch principal: `main`.
- Branches de trabalho seguem o padrão `codex/<nome-da-tarefa>`.

## Antes de tentar enviar: confirme o que realmente está pendente

```bash
git fetch origin
git status
git diff origin/<sua-branch> HEAD --stat
```

Se `git status` mostrar "nothing to commit, working tree clean" e o `diff` acima
vier vazio, **não há nada pendente** — o que parecia uma falha de envio pode já
ter sido concluído em uma tentativa anterior (ou por outro agente/pessoa no
mesmo repositório). Não recrie commits ou force push sem confirmar isso primeiro.

## Como enviar (commit + push)

```bash
git add <arquivos>
git commit -m "mensagem"
git push origin <sua-branch>
```

## Causas comuns de falha ao enviar (principalmente para agentes em sandbox)

1. **Sem acesso à chave SSH do usuário.** Agentes que rodam em um ambiente
   isolado (sandbox/container na nuvem) normalmente não têm a chave SSH privada
   do usuário disponível, mesmo estando no mesmo repositório.
   - Diagnóstico: `ssh -T git@github.com` — se der erro de autenticação,
     timeout ou "Permission denied (publickey)", é isso.
   - Solução: configurar o remoto com HTTPS + um Personal Access Token (PAT)
     do GitHub como variável de ambiente/segredo no agente, em vez de depender
     da chave SSH local. Alternativa: cadastrar uma *deploy key* própria para
     o agente com permissão de escrita no repositório.

2. **Sem acesso à rede (sandbox sem saída para github.com).** O agente
   consegue commitar localmente, mas o `git push` trava ou falha por timeout
   de rede — sem relação com credenciais.
   - Diagnóstico: o commit existe localmente (`git log`) mas `git push` nunca
     retorna ou cai com erro de conexão.
   - Solução: não tem ajuste de configuração que resolva isso de dentro do
     sandbox. O commit precisa ser enviado por um ambiente com acesso real à
     internet — por exemplo, pedindo para o Claude Code (que roda localmente
     nesta máquina e já tem a chave SSH configurada) fazer o `git push`.

3. **Identidade do Git não configurada.** Falha ao *commitar*, não ao enviar.
   - Solução: `git config user.name "..."` e `git config user.email "..."`.

4. **Branch divergente** — alguém (pessoa ou outro agente) enviou commits novos
   para a mesma branch remota enquanto o agente trabalhava, e o push é
   rejeitado como non-fast-forward.
   - Solução: `git fetch origin && git rebase origin/<sua-branch>` (ou merge)
     antes de tentar de novo. Nunca usar `--force` sem entender o que está
     sendo sobrescrito.

## Confirmado nesta máquina

A partir deste ambiente (Windows, usuário `leandro.santos`), `ssh -T
git@github.com` autentica com sucesso com a chave configurada para
`leandropronet`, e o `git push` funciona normalmente. Se um agente em outro
ambiente (ex.: Codex em sandbox na nuvem) não conseguir enviar, o motivo mais
provável é a causa 1 ou 2 acima — **não** é um problema de configuração deste
repositório.
