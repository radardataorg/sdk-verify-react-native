/** Erros do SDK do Verify. */
export class ErroVerify extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string | null = null,
    readonly status: number | null = null,
    readonly corpo: Record<string, unknown> = {},
    opcoes?: { cause?: unknown },
  ) {
    super(mensagem, opcoes);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * O token da sessao nao serve mais: expirou, foi cancelada ou nunca existiu.
 *
 * Separado porque a acao do app e outra: nao e tentar de novo, e pedir uma
 * sessao nova ao SEU backend. O app nunca cria sessao sozinho, porque isso
 * exigiria o token de API da empresa dentro do aparelho.
 */
export class SessaoInvalida extends ErroVerify {}

/** O passo pedido nao e o passo em que a sessao esta (409 do runtime). */
export class PassoForaDeOrdem extends ErroVerify {}

/** A pessoa negou a camera, ou o aparelho nao tem uma. */
export class SemCamera extends ErroVerify {}

/** Biometria indisponivel do nosso lado (503). */
export class BiometriaIndisponivel extends ErroVerify {}

/** Nao houve resposta: timeout, DNS, sem rede. */
export class FalhaDeRede extends ErroVerify {}

/** @internal */
export function erroDoStatus(
  status: number,
  mensagem: string,
  codigo: string | null,
  corpo: Record<string, unknown>,
): ErroVerify {
  if (status === 401 || status === 404 || status === 410) {
    return new SessaoInvalida(mensagem, codigo, status, corpo);
  }
  if (status === 409) return new PassoForaDeOrdem(mensagem, codigo, status, corpo);
  if (status === 503) return new BiometriaIndisponivel(mensagem, codigo, status, corpo);
  return new ErroVerify(mensagem, codigo, status, corpo);
}
