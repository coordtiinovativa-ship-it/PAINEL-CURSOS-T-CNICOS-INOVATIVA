import type { Perfil } from './auth/permissoes';

export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  trocar_senha: number;
  tema: 'sistema' | 'claro' | 'escuro';
  /** Permissões efetivas (perfil + ajustes do usuário), calculadas a cada requisição. */
  permissoes?: string[];
}

export type Env = {
  Bindings: {
    DB: D1Database;
    ARQUIVOS: R2Bucket;
    ASSETS?: Fetcher;
    /** Rate Limiting do Workers (wrangler.toml [[ratelimits]]) */
    LIMITE_VALIDACAO?: RateLimit;
    LIMITE_LOGIN?: RateLimit;
    AMBIENTE: string;
    URL_PUBLICA: string;
  };
  Variables: { usuario: UsuarioSessao };
};
