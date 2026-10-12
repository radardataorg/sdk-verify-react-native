import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { type ProvedorDeProvaDeVida, semProvedorNativo } from "./nativo/provedor.js";
import { ErroVerify } from "./nucleo/erros.js";
import { Orquestrador } from "./nucleo/orquestrador.js";
import { Runtime, tokenDaUrl } from "./nucleo/runtime.js";
import { type Desfecho, type EstadoSessao, terminou } from "./nucleo/tipos.js";

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
  /** De quanto em quanto tempo perguntar ao servidor se acabou, em ms. */
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
  intervaloDeConferenciaMs = 2500,
  onDesfecho,
  onEstado,
}: PropsVerify) {
  const token = useMemo(() => tokenDaUrl(sessao), [sessao]);
  const runtime = useMemo(() => new Runtime(token, base ? { base } : {}), [token, base]);
  const orquestrador = useMemo(() => new Orquestrador(runtime, provedorDeProvaDeVida), [runtime, provedorDeProvaDeVida]);

  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const encerrado = useRef(false);

  const encerrar = useCallback(
    (d: Desfecho) => {
      if (encerrado.current) return;
      encerrado.current = true;
      onDesfecho(d);
    },
    [onDesfecho],
  );

  // Abre o fluxo e decide, no primeiro estado, se da para fazer nativo.
  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const estado = await orquestrador.estado();
        if (!vivo) return;
        onEstado?.(estado);

        if (terminou(estado)) {
          encerrar({ tipo: "concluido", estado });
          return;
        }

        if (await orquestrador.rodaNativo(estado)) {
          const depois = await orquestrador.provaDeVidaNativa();
          if (!vivo) return;
          onEstado?.(depois);

          if (terminou(depois)) {
            encerrar({ tipo: "concluido", estado: depois });
            return;
          }
        }

        // Sobrou passo que este pacote nao roda nativo: WebView.
        if (vivo) {
          setUrl(sessao.includes("/") ? sessao : null);
          setCarregando(false);
        }
      } catch (e) {
        if (vivo) encerrar({ tipo: "erro", erro: e instanceof Error ? e : new ErroVerify(String(e)) });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [orquestrador, sessao, encerrar, onEstado]);

  // Pergunta ao servidor se terminou. E o contrato, e nao o HTML da pagina.
  useEffect(() => {
    if (url === null) return;

    const relogio = setInterval(async () => {
      try {
        const estado = await runtime.bootstrap();
        onEstado?.(estado);
        if (terminou(estado)) {
          clearInterval(relogio);
          encerrar({ tipo: "concluido", estado });
        }
      } catch {
        // Falha de rede no meio do fluxo nao encerra nada: a pessoa pode
        // estar no elevador. A proxima rodada tenta de novo.
      }
    }, intervaloDeConferenciaMs);

    return () => clearInterval(relogio);
  }, [url, runtime, intervaloDeConferenciaMs, encerrar, onEstado]);

  if (carregando || url === null) {
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
      // A prova de vida precisa da camera, e sem estes tres o WebView a nega
      // sem dizer por que, o que parece defeito do fluxo.
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      onPermissionRequest={(evento: { nativeEvent: { grant: () => void } }) => evento.nativeEvent.grant()}
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
