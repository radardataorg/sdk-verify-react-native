/**
 * O contrato do provedor NATIVO de prova de vida.
 *
 * A prova de vida do RadarData tem duas formas de rodar dentro do app, e este
 * arquivo existe para que o app nao precise saber qual esta em uso:
 *
 * 1. WEBVIEW (o que vem pronto nesta versao). Abre a pagina do fluxo, que ja
 *    roda a prova de vida testada em producao. Funciona hoje, em iOS e
 *    Android, e pede a camera pelo WebView.
 * 2. NATIVO (este contrato). Uma implementacao que faca a captura no proprio
 *    aparelho. O servidor ja esta pronto: o `POST /liveness/start` devolve o
 *    desafio, e e ele que a implementacao nativa recebe.
 *
 * Trocar um pelo outro nao muda a API publica do pacote, de proposito: o dia
 * em que a implementacao nativa existir, quem ja integrou troca uma linha.
 */
export interface ProvedorDeProvaDeVida {
  /** Dizer se da para usar este provedor neste aparelho, agora. */
  disponivel(): Promise<boolean>;

  /**
   * Roda a prova de vida e resolve quando a pessoa terminou.
   *
   * NAO devolve veredito: quem avalia e o servidor, no
   * `POST /liveness/result`. Um provedor que decidisse aqui estaria deixando o
   * aparelho do usuario final decidir a propria aprovacao.
   *
   * @param desafio o que o `POST /liveness/start` devolveu
   */
  executar(desafio: Record<string, unknown>): Promise<void>;
}

/**
 * Provedor que diz "nao sei fazer".
 *
 * E o padrao, e nao e um erro: com ele o fluxo cai no WebView, que faz a prova
 * de vida de verdade. Ele existe para o caminho nativo poder ser ligado sem
 * mudar nada no app de quem integrou.
 */
export const semProvedorNativo: ProvedorDeProvaDeVida = {
  async disponivel() {
    return false;
  },
  async executar() {
    throw new Error(
      "Prova de vida nativa não está disponível nesta versão do @radardata/verify-react-native. " +
        "O fluxo usa WebView, que faz a prova de vida completa.",
    );
  },
};
