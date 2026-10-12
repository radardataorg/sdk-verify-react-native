/** O que o runtime do Verify entende, e o que o app precisa saber. */

/**
 * Tipos de passo de um fluxo.
 *
 * `liveness` e `document` precisam da CAMERA. O resto e coleta de dado e nao
 * precisa de nada do aparelho, e e por isso que o fallback de WebView cobre
 * esses sem perda.
 */
export type TipoPasso =
  | "consent"
  | "fields"
  | "document"
  | "liveness"
  | "socio_check"
  | "apontamentos"
  | (string & {});

export interface Passo {
  readonly tipo: TipoPasso;
  readonly chave?: string;
  readonly config?: Record<string, unknown>;
}

/** O estado da sessao, como o runtime o descreve. */
export interface EstadoSessao {
  readonly sessionId: string;
  /** pending, in_progress, completed, expired, canceled. */
  readonly status: string;
  /** O passo em que a sessao esta, ou null quando acabou. */
  readonly etapaAtual: string | null;
  /** APROVADO, REPROVADO, REVISAO_MANUAL; null enquanto nao concluiu. */
  readonly resultado: string | null;
  /** Por que nao aprovou, em texto neutro para mostrar a pessoa. */
  readonly motivo: string | null;
  readonly passos: readonly Passo[];
  /** Cores e logo do cliente, para o app nao parecer de outra marca. */
  readonly branding: Record<string, unknown>;
  readonly cru: Record<string, unknown>;
}

export type Desfecho =
  | { readonly tipo: "concluido"; readonly estado: EstadoSessao }
  | { readonly tipo: "cancelado" }
  | { readonly tipo: "erro"; readonly erro: Error };

/** @internal */
export function paraEstado(d: Record<string, unknown>): EstadoSessao {
  const resultados = (d.resultados ?? {}) as Record<string, unknown>;

  return {
    sessionId: String(d.session_id ?? ""),
    status: String(d.status ?? ""),
    etapaAtual: (d.etapa_atual as string | null) ?? null,
    resultado: (d.outcome as string | null) ?? null,
    motivo: (d.motivo as string | null) ?? null,
    passos: Array.isArray(d.steps) ? (d.steps as Passo[]) : [],
    branding: (d.branding ?? {}) as Record<string, unknown>,
    cru: { ...d, resultados },
  };
}

/** Acabou, de qualquer jeito: nao ha mais o que a pessoa possa fazer. */
export function terminou(estado: EstadoSessao): boolean {
  return ["completed", "expired", "canceled"].includes(estado.status);
}
