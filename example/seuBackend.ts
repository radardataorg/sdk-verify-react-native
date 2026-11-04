/**
 * O que o app pede ao SEU backend. O contrato aqui e seu: o RadarData so aparece
 * do outro lado, no servidor, e e por isso que o token de API nao vem para o app.
 */

export interface SessaoCriada {
  readonly id: string;
  readonly url: string;
}

export interface SessaoConfirmada {
  readonly status: string;
  readonly resultado: string | null;
}

export class ErroDoBackend extends Error {
  constructor(
    mensagem: string,
    /** Dados que o fluxo exige e nao vieram, por campo. */
    readonly campos: Readonly<Record<string, string>> = {},
  ) {
    super(mensagem);
    this.name = "ErroDoBackend";
    Object.setPrototypeOf(this, ErroDoBackend.prototype);
  }
}

export function criarSessao(
  backend: string,
  fluxo: string,
  input: Record<string, string>,
): Promise<SessaoCriada> {
  return pedir(backend, "POST", "/sessoes", { fluxo, input });
}

export function confirmarSessao(backend: string, id: string): Promise<SessaoConfirmada> {
  return pedir(backend, "GET", `/sessoes/${encodeURIComponent(id)}`);
}

async function pedir<T>(backend: string, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${backend.replace(/\/+$/, "")}${caminho}`, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroDoBackend("Não consegui falar com o backend. Ele está rodando e o cabo está conectado?");
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new ErroDoBackend(dados.erro?.mensagem ?? `O backend respondeu ${resposta.status}.`, dados.erro?.campos);
  }

  return dados as T;
}
