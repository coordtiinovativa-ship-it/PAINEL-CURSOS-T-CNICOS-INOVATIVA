-- Permissões por usuário (decisão de 18/11/2026): cada usuário segue o padrão do perfil, e o admin master ou o
-- administrador pode LIBERAR (concedida = 1) ou BLOQUEAR (concedida = 0) uma função só para ele.
-- Sem linha = padrão do perfil. O admin master sempre pode tudo (não tem ajustes).
CREATE TABLE usuario_permissoes (
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
  permissao      TEXT NOT NULL,
  concedida      INTEGER NOT NULL CHECK (concedida IN (0, 1)),
  atualizado_por TEXT,
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (usuario_id, permissao)
);
