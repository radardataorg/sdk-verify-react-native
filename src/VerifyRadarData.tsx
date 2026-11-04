import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { type ProvedorDeProvaDeVida, semProvedorNativo } from "./nativo/provedor.js";
import { ErroVerify } from "./nucleo/erros.js";
import { Orquestrador } from "./nucleo/orquestrador.js";
import { Runtime, tokenDaUrl } from "./nucleo/runtime.js";
import type { Desfecho, EstadoSessao } from "./nucleo/tipos.js";

/**
 * De quanto em quanto tempo o componente pergunta se a sessao acabou.
 *
 * Cada pergunta e um acesso registrado na auditoria da sessao e conta no limite
 * de taxa do runtime, que o WebView aberto ao lado tambem usa. Cinco segundos
 * custam metade dos 2,5 s da 0.1.1, e a pessoa ja ve o resultado na propria
 * pagina enquanto o app nao fica sabendo.
 */
const INTERVALO_PADRAO_MS = 5000;
/** Abaixo disto o polling disputa o limite de taxa com o proprio fluxo. */
const INTERVALO_MINIMO_MS = 2000;

export interface PropsVerify {
  /**
   * A url OU o token da sessao, como o SEU backend devolveu.
   *
   * O app nunca cria a sessao: isso exigiria o token de API da empresa dentro
   * do aparelho, e token de API em aparelho de usuario final e token vazado.
   * O seu backend cria com o `@radardata/sdk` ou o `radardata/sdk-php` e passa
   * o resultado adiante.
   */
  sessao: string;
  /** Base da api. Troque para apontar a um ambiente seu. */
  base?: string;
  /** Prova de vida nativa. Sem ela, o fluxo todo roda no WebView. */
  provedorDeProvaDeVida?: ProvedorDeProvaDeVida;
  /** De quanto em quanto tempo perguntar ao servidor se acabou, em ms. Padrao 5000, minimo 2000. */
  intervaloDeConferenciaMs?: number;
  onDesfecho: (desfecho: Desfecho) => void;
  /** Chamado a cada mudanca de estado, para o app acompanhar sem decidir. */
  onEstado?: (estado: EstadoSessao) => void;
}

/**
 * O RadarData Verify dentro do seu app.
 *
 * Nesta versao o fluxo roda em WebView, que e a mesma pagina testada em
 * producao, e por isso faz a prova de vida completa. O caminho nativo esta
 * preparado: passe um `provedorDeProvaDeVida` e o passo de prova de vida sai
 * do WebView sem mudar mais nada aqui.
 *
 * Como o componente sabe que terminou: ele PERGUNTA AO SERVIDOR, em intervalo,
 * em vez de espiar a navegacao do WebView. Depender da url de redirecionamento
 * ou de mensagem da pagina amarraria o pacote ao HTML do runtime, que muda sem
 * aviso; o estado da sessao e contrato.
 */
export function VerifyRadarData({
  sessao,
  base,
  provedorDeProvaDeVida = semProvedorNativo,
  intervaloDeConferenciaMs = INTERVALO_PADRAO_MS,
  onDesfecho,
  onEstado,
}: PropsVerify) {
  // Os callbacks e o provedor ficam em ref para nao serem dependencia dos
  // efeitos abaixo. Funcao ou objeto inline muda a cada render: com eles na
  // dependencia, um onEstado que guarda estado reabria a sessao a cada resposta,
  // num laco contra o servidor que so acabava no 429.
  const aoDesfecho = useRef(onDesfecho);
  const aoEstado = useRef(onEstado);
  const provedor = useRef(provedorDeProvaDeVida);
  useEffect(() => {
    aoDesfecho.current = onDesfecho;
    aoEstado.current = onEstado;
    provedor.current = provedorDeProvaDeVida;
  });

  const token = useMemo(() => tokenDaUrl(sessao), [sessao]);
  // Sessao vazia faz o Runtime recusar. Isso vira desfecho de erro, e nao
  // excecao no render, que derrubaria a tela de quem integrou.
  const orquestrador = useMemo(() => {
    try {
      return new Orquestrador(new Runtime(token, base ? { base } : {}), {
        disponivel: () => provedor.current.disponivel(),
        executar: (desafio) => provedor.current.executar(desafio),
      });
    } catch (e) {
      return e instanceof Error ? e : new ErroVerify(String(e));
    }
  }, [token, base]);
  const intervalo = Number.isFinite(intervaloDeConferenciaMs)
    ? Math.max(INTERVALO_MINIMO_MS, intervaloDeConferenciaMs)
    : INTERVALO_PADRAO_MS;

  const [url, setUrl] = useState<string | null>(null);
  const encerrado = useRef(false);
  // A sessao cujo desfecho ja saiu. Trocar `base` com a mesma sessao reabre o
  // fluxo, mas nao pode entregar um segundo desfecho.
  const sessaoAberta = useRef<string | null>(null);

  const encerrar = useCallback((d: Desfecho) => {
    if (encerrado.current) return;
    encerrado.current = true;
    aoDesfecho.current(d);
  }, []);

  // Abre o fluxo e decide, no primeiro estado, se da para fazer nativo.
  useEffect(() => {
    let vivo = true;
    if (sessaoAberta.current !== token) {
      sessaoAberta.current = token;
      encerrado.current = false;
    }
    setUrl(null);

    if (!(orquestrador instanceof Orquestrador)) {
      encerrar({ tipo: "erro", erro: orquestrador });
      return;
    }

    (async () => {
      try {
        const estado = await orquestrador.estado();
        if (!vivo) return;
        aoEstado.current?.(estado);

        const acabou = Orquestrador.desfechoDoEstado(estado);
        if (acabou) return encerrar(acabou);

        const nativo = await orquestrador.rodaNativo(estado);
        if (!vivo) return;
        if (nativo) {
          const depois = await orquestrador.provaDeVidaNativa();
          if (!vivo) return;
          aoEstado.current?.(depois);

          const acabouDepois = Orquestrador.desfechoDoEstado(depois);
          if (acabouDepois) return encerrar(acabouDepois);
        }

        // Sobrou passo que este pacote nao roda nativo: WebView.
        if (vivo) setUrl(orquestrador.urlDoFluxo(sessao));
      } catch (e) {
        if (vivo) encerrar(Orquestrador.desfechoDoErro(e));
      }
    })();

    return () => {
      vivo = false;
    };
  }, [orquestrador, token, sessao, encerrar]);

  // Pergunta ao servidor se terminou. E o contrato, e nao o HTML da pagina.
  // Uma pergunta por vez: a proxima so e agendada quando a anterior volta, para
  // rede lenta nao empilhar requisicoes.
  useEffect(() => {
    if (url === null || !(orquestrador instanceof Orquestrador)) return;

    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;

    const rodada = async () => {
      const { estado, desfecho } = await orquestrador.conferir();
      // A pessoa pode ter saido, ou o fluxo encerrado, enquanto a resposta vinha.
      if (!vivo || encerrado.current) return;

      if (estado) {
        try {
          aoEstado.current?.(estado);
        } catch (e) {
          // Erro no onEstado do app nao pode parar a conferencia em silencio:
          // sobe fora daqui, onde o app ve, e a rodada segue.
          setTimeout(() => {
            throw e;
          });
        }
      }
      if (desfecho) return encerrar(desfecho);

      relogio = setTimeout(rodada, intervalo);
    };
    relogio = setTimeout(rodada, intervalo);

    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [url, orquestrador, intervalo, encerrar]);

  if (url === null) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <WebView
      source={{ uri: url }}
      style={estilos.cheio}
      // A prova de vida precisa da camera, e sem estes o WebView a nega sem dizer
      // por que, o que parece defeito do fluxo. No Android quem concede e o proprio
      // react-native-webview; o grant type vale so para o iOS.
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
      // Fluxo com localizacao pede por aqui, e desligado o Android nega sem perguntar.
      geolocationEnabled
      // Alguns aparelhos Android recusam `getUserMedia` sem isto.
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={["https://*"]}
      onError={({ nativeEvent }) =>
        encerrar({
          tipo: "erro",
          erro: new ErroVerify(`O fluxo do Verify não carregou: ${nativeEvent.description}`),
        })
      }
    />
  );
}

const estilos = StyleSheet.create({
  cheio: { flex: 1 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
});
