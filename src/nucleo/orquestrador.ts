import type { ProvedorDeProvaDeVida } from "../nativo/provedor.js";
import { ErroVerify, SessaoInvalida } from "./erros.js";
import { Runtime, urlDaSessao } from "./runtime.js";
import { type Desfecho, type EstadoSessao, type TipoPasso, terminou } from "./tipos.js";

/**
 * Decide, passo a passo, o que roda NATIVO e o que cai no WEBVIEW.
 *
 * A regra e simples e vem do pedido: nativo cuida do que precisa do APARELHO,
 * e o resto, que e coleta de dado, vai para o WebView sem perda. Hoje, na
 * pratica, isso quer dizer prova de vida nativa quando houver provedor, e
 * WebView para todo o resto, inclusive foto de documento, que ainda nao tem
 * caminho nativo neste pacote.
 *
 * O orquestrador e separado do componente de tela de proposito: assim esta
 * decisao e testavel sem renderizar nada, e e ela que importa.
 */
export class Orquestrador {
  constructor(
    private readonly runtime: Runtime,
    private readonly provedorNativo: ProvedorDeProvaDeVida,
  ) {}

  /** Passos que este pacote sabe rodar sem abrir WebView. */
  private static readonly NATIVOS: readonly TipoPasso[] = ["liveness"];

  async estado(): Promise<EstadoSessao> {
    return this.runtime.bootstrap();
  }

  /**
   * O passo atual roda nativo?
   *
   * Pergunta ao provedor, e nao so ao tipo do passo: um aparelho sem camera,
   * ou alguem que negou a permissao, tem de cair no WebView em vez de travar.
   */
  async rodaNativo(estado: EstadoSessao): Promise<boolean> {
    const etapa = estado.etapaAtual;
    if (!etapa || terminou(estado)) return false;

    const passo = estado.passos.find((p) => (p.chave ?? p.tipo) === etapa || p.tipo === etapa);
    if (!passo || !Orquestrador.NATIVOS.includes(passo.tipo)) return false;

    return this.provedorNativo.disponivel();
  }

  /**
   * Roda a prova de vida nativa de ponta a ponta.
   *
   * A ordem importa: o servidor cria o desafio, o nativo o executa, e o
   * SERVIDOR busca o resultado e avalia. O app nao decide nada.
   */
  async provaDeVidaNativa(): Promise<EstadoSessao> {
    const desafio = await this.runtime.livenessStart();
    await this.provedorNativo.executar(desafio);

    return this.runtime.livenessResultado();
  }

  /**
   * Pergunta ao servidor se acabou, e diz o desfecho quando acabar.
   *
   * Falha de rede nao encerra nada: a pessoa pode estar no elevador, e a
   * proxima rodada tenta de novo. Sessao que expirou ou foi cancelada e outra
   * coisa: o servidor responde 410, e repetir nunca vai mudar a resposta.
   */
  async conferir(): Promise<{ estado: EstadoSessao | null; desfecho: Desfecho | null }> {
    try {
      const estado = await this.runtime.bootstrap();
      return { estado, desfecho: Orquestrador.desfechoDoEstado(estado) };
    } catch (e) {
      if (e instanceof SessaoInvalida) return { estado: null, desfecho: Orquestrador.desfechoDoErro(e) };
      return { estado: null, desfecho: null };
    }
  }

  /** O desfecho de um estado, ou null enquanto a sessao esta aberta. */
  static desfechoDoEstado(estado: EstadoSessao): Desfecho | null {
    if (!terminou(estado)) return null;
    if (estado.status === "canceled") return { tipo: "cancelado" };
    return { tipo: "concluido", estado };
  }

  /**
   * O desfecho de um erro que encerra o fluxo.
   *
   * A pessoa nao tem como cancelar dentro do fluxo: quem cancela e o backend de
   * quem integra, pela API. Isso nao e falha, e por isso vira `cancelado` e nao
   * `erro`. O servidor diz qual foi no corpo do 410; expirada continua erro,
   * porque ali o app precisa pedir uma sessao nova.
   */
  static desfechoDoErro(e: unknown): Desfecho {
    if (e instanceof SessaoInvalida && e.status === 410 && statusNoCorpo(e.corpo) === "canceled") {
      return { tipo: "cancelado" };
    }
    return { tipo: "erro", erro: e instanceof Error ? e : new ErroVerify(String(e)) };
  }

  /** A url que o WebView deve abrir para continuar de onde esta. */
  urlDoFluxo(urlOuToken: string): string {
    return urlDaSessao(urlOuToken);
  }
}

function statusNoCorpo(corpo: Record<string, unknown>): unknown {
  const erro = corpo.error;
  return erro && typeof erro === "object" ? (erro as Record<string, unknown>).status : undefined;
}
