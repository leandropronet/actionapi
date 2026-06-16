-- Schema AUDIT: registra operações de escrita no Oracle (Fase 2).
-- Criado agora para não precisar de migration depois.

CREATE TABLE IF NOT EXISTS audit.log (
  id              BIGSERIAL PRIMARY KEY,
  operacao        TEXT NOT NULL,        -- assinar_duplicata | protocolar_nf | baixar_duplicata
  tabela_oracle   TEXT NOT NULL,        -- nome da tabela Oracle alterada
  registro_id     TEXT NOT NULL,        -- ID do registro alterado
  campo           TEXT NOT NULL,        -- campo alterado
  valor_anterior  TEXT,
  valor_novo      TEXT,
  usuario         TEXT NOT NULL,        -- usuário do SaaS que executou
  api_key_hash    TEXT,                 -- hash da API key usada
  ip_origem       TEXT,
  status          TEXT NOT NULL,        -- sucesso | erro
  erro_mensagem   TEXT,
  executado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_registro ON audit.log(tabela_oracle, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit.log(usuario, executado_em);
CREATE INDEX IF NOT EXISTS idx_audit_log_executado ON audit.log(executado_em);
