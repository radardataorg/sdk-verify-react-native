import type { ProvedorDeProvaDeVida } from "../nativo/provedor.js";
import { Runtime } from "./runtime.js";
import { type EstadoSessao, type TipoPasso, terminou } from "./tipos.js";

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

  /** A url que o WebView deve abrir para continuar de onde esta. */
  urlDoFluxo(urlDaSessao: string): string {
    return urlDaSessao;
  }
}
