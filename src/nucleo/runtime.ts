import { ErroVerify, FalhaDeRede, erroDoStatus } from "./erros.js";
import { type EstadoSessao, paraEstado } from "./tipos.js";

/**
 * Cliente do RUNTIME do Verify (`/api/verify/rt/{token}`).
 *
 * Esta superficie e diferente da `/api/v2`, e a diferenca importa: aqui a
 * credencial e o TOKEN DA SESSAO, que vem no link, e nao o token de API da
 * empresa. O app nunca deve carregar o token de API: ele pede ao SEU backend
 * uma sessao (que o backend cria com o `@radardata/sdk` ou com o
 * `radardata/sdk-php`) e recebe de volta a url ou o token da sessao.
 *
 * Esse desenho e deliberado: token de API dentro de aparelho de usuario final
 * e token vazado, e com ele da para gastar o saldo da empresa.
 */
export class Runtime {
  private readonly base: string;

  constructor(
    private readonly token: string,
    opcoes: { base?: string; timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
  ) {
    if (!token) throw new ErroVerify("Token da sessão do Verify é obrigatório.");

    this.base = (opcoes.base ?? "https://api.radardata.com.br/api").replace(/\/+$/, "");
    this.timeoutMs = opcoes.timeoutMs ?? 30_000;
    this.buscar = opcoes.fetch ?? globalThis.fetch;
  }

  private readonly timeoutMs: number;

  private readonly buscar: typeof globalThis.fetch;

  /** O estado atual da sessao e a lista de passos. */
  async bootstrap(): Promise<EstadoSessao> {
    return paraEstado(await this.pedir("GET", "bootstrap"));
  }

  /** Cria o desafio de prova de vida e devolve o que o nativo precisa. */
  async livenessStart(): Promise<Record<string, unknown>> {
    return this.pedir("POST", "liveness/start");
  }

  /**
   * Fecha a prova de vida: o SERVIDOR busca o resultado e avalia.
   *
   * O app nao decide nada, e isso e de proposito: quem decide aprovacao de
   * biometria no aparelho do usuario final nao decide nada, decide o usuario.
   */
  async livenessResultado(): Promise<EstadoSessao> {
    return paraEstado(await this.pedir("POST", "liveness/result"));
  }

  async consentimento(aceito = true): Promise<EstadoSessao> {
    return paraEstado(await this.pedir("POST", "consent", { aceito }));
  }

  async campos(valores: Record<string, unknown>): Promise<EstadoSessao> {
    return paraEstado(await this.pedir("POST", "fields", valores));
  }

  /** @internal Usado pelos provedores nativos que sobem artefato direto no S3. */
  async credenciais(): Promise<Record<string, unknown>> {
    return this.pedir("POST", "credentials");
  }

  private async pedir(
    metodo: string,
    caminho: string,
    corpo?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.base}/verify/rt/${encodeURIComponent(this.token)}/${caminho}`;
    const abortar = new AbortController();
    const relogio = setTimeout(() => abortar.abort(), this.timeoutMs);

    let resposta: Response;
    try {
      resposta = await this.buscar(url, {
        method: metodo,
        headers: {
          Accept: "application/json",
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: abortar.signal,
      });
    } catch (e) {
      throw new FalhaDeRede(
        `Não foi possível falar com o RadarData: ${e instanceof Error ? e.message : String(e)}`,
        "falha_de_rede",
        null,
        {},
        { cause: e },
      );
    } finally {
      clearTimeout(relogio);
    }

    const cru = await resposta.text();
    let json: unknown = {};
    try {
      json = cru === "" ? {} : JSON.parse(cru);
    } catch {
      json = {};
    }
    const dados = (json ?? {}) as Record<string, unknown>;

    if (!resposta.ok) {
      const erro = (dados.error ?? {}) as { code?: string; message?: string };
      throw erroDoStatus(
        resposta.status,
        erro.message ?? (dados.message as string | undefined) ?? `O RadarData respondeu ${resposta.status}.`,
        erro.code ?? null,
        dados,
      );
    }

    return dados;
  }
}

/**
 * O token da sessao a partir da url que o seu backend devolveu.
 *
 * A url e `https://<dominio>/s/<token>`, e aceitar as duas formas poupa o app
 * de saber disso: quem integra guarda o que recebeu e passa adiante.
 */
export function tokenDaUrl(urlOuToken: string): string {
  const limpo = urlOuToken.trim();
  if (!limpo.includes("/")) return limpo;

  const partes = limpo.replace(/[?#].*$/, "").split("/").filter(Boolean);
  return partes[partes.length - 1] ?? "";
}
