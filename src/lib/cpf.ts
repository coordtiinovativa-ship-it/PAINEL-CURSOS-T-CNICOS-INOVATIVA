export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

export function validarCPF(entrada: string): boolean {
  const cpf = somenteDigitos(entrada);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(cpf[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

export function formatarCPF(entrada: string): string {
  const c = somenteDigitos(entrada);
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9, 11)}`;
}

/**
 * RG unificado ao CPF (Carteira de Identidade Nacional — CIN): o número do RG é o próprio CPF.
 * Com a opção ligada, o RG vira o CPF formatado (sempre sincronizado). RG igual ao CPF liga a opção.
 * Órgão expedidor e UF continuam sendo informados (ex.: SEJUSP-MS).
 */
export function ajustarRgUnificado(d: { cpf?: string | null; rg?: string | null; rg_unificado_cpf?: string | null }): void {
  const cpf = d.cpf ? somenteDigitos(d.cpf) : '';
  if (cpf.length !== 11) return;
  if (d.rg && somenteDigitos(d.rg) === cpf) d.rg_unificado_cpf = '1';
  if (d.rg_unificado_cpf === '1') d.rg = formatarCPF(cpf);
}

/** LGPD: 123.456.789-09 → ***.456.789-** */
export function mascararCPF(entrada: string): string {
  const c = somenteDigitos(entrada);
  if (c.length !== 11) return '***.***.***-**';
  return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
}
