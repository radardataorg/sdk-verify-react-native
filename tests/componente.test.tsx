import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Desfecho, EstadoSessao } from "../src/nucleo/tipos.js";

/**
 * O componente de tela, com o React Native trocado por nomes. O que se testa e o
 * ciclo das requisicoes: quantas saem, quando param e quantos desfechos chegam.
 * Foi ai que a primeira execucao em aparelho achou defeito (D-0086).
 */
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: <T,>(estilos: T) => estilos },
  View: "View",
}));
vi.mock("react-native-webview", () => ({ WebView: "WebView" }));

const { VerifyRadarData } = await import("../src/VerifyRadarData.js");
const { SessaoInvalida } = await import("../src/nucleo/erros.js");

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

const estado = (status = "in_progress", etapa: string | null = "document") => ({
  session_id: "sess-1",
  status,
  etapa_atual: etapa,
  outcome: status === "completed" ? "APROVADO" : null,
  motivo: null,
  steps: [{ tipo: "document" }],
  branding: {},
});

const encerrada = (status: "canceled" | "expired") =>
  resposta({ error: { code: "sessao_encerrada", message: "acabou", status } }, 410);

let respostas: Array<() => Response>;
let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  respostas = [];
  fetchFalso = vi.fn(async () => (respostas.shift() ?? (() => resposta(estado())))());
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Deixa as promessas pendentes andarem, sem avancar o relogio. */
const esvaziar = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

const avancar = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

function montar(props: Partial<React.ComponentProps<typeof VerifyRadarData>> = {}) {
  const desfechos: Desfecho[] = [];
  let tela!: TestRenderer.ReactTestRenderer;
  act(() => {
    tela = TestRenderer.create(
      <VerifyRadarData sessao="https://verify.exemplo/s/tok" onDesfecho={(d) => desfechos.push(d)} {...props} />,
    );
  });
  return { desfechos, tela: () => tela };
}

describe("componente VerifyRadarData", () => {
  it("onEstado inline que guarda estado nao reabre a sessao a cada resposta", async () => {
    function App() {
      const [, setVisto] = useState<EstadoSessao | null>(null);
      return (
        <VerifyRadarData
          sessao="tok"
          provedorDeProvaDeVida={{ disponivel: async () => false, executar: async () => {} }}
          onDesfecho={() => {}}
          onEstado={(e) => setVisto(e)}
        />
      );
    }

    act(() => {
      TestRenderer.create(<App />);
    });
    await esvaziar();
    await avancar(20_000);

    // Um bootstrap ao abrir e um a cada 5 s. Com o laco, seriam centenas.
    expect(fetchFalso.mock.calls.length).toBe(1 + 4);
  });

  it("so com o token, abre o WebView no dominio padrao", async () => {
    const { tela } = montar({ sessao: "tok" });
    await esvaziar();

    expect(tela().root.findByType("WebView" as never).props.source).toEqual({
      uri: "https://verify.radardata.com.br/s/tok",
    });
  });

  it("cancelada no meio do fluxo encerra como cancelado e para de perguntar", async () => {
    respostas = [() => resposta(estado()), () => encerrada("canceled")];
    const { desfechos } = montar();
    await esvaziar();
    await avancar(30_000);

    expect(desfechos).toEqual([{ tipo: "cancelado" }]);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("expirada no meio do fluxo encerra com SessaoInvalida e para de perguntar", async () => {
    respostas = [() => resposta(estado()), () => encerrada("expired")];
    const { desfechos } = montar();
    await esvaziar();
    await avancar(30_000);

    expect(desfechos).toHaveLength(1);
    expect(desfechos[0]?.tipo === "erro" && desfechos[0].erro).toBeInstanceOf(SessaoInvalida);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("falha de rede nao encerra, e a rodada seguinte conclui uma vez so", async () => {
    respostas = [
      () => resposta(estado()),
      () => {
        throw new TypeError("sem sinal");
      },
      () => resposta(estado("completed", null)),
    ];
    const { desfechos } = montar();
    await esvaziar();
    await avancar(30_000);

    expect(desfechos.map((d) => d.tipo)).toEqual(["concluido"]);
    expect(fetchFalso).toHaveBeenCalledTimes(3);
  });

  it("rede lenta nao empilha perguntas", async () => {
    respostas = [() => resposta(estado())];
    montar();
    await esvaziar();

    // A partir daqui cada pergunta demora 12 s para voltar.
    fetchFalso.mockImplementation(
      () => new Promise((ok) => setTimeout(() => ok(resposta(estado())), 12_000)),
    );
    await avancar(34_000);

    // 5 s ate a primeira, 12 s de espera, mais 5 s e outra: duas, e nao seis.
    expect(fetchFalso).toHaveBeenCalledTimes(1 + 2);
  });

  it("intervalo abaixo do minimo vira o minimo", async () => {
    montar({ intervaloDeConferenciaMs: 10 });
    await esvaziar();
    await avancar(10_000);

    expect(fetchFalso).toHaveBeenCalledTimes(1 + 5);
  });

  it("depois de desmontar, nenhuma pergunta e nenhum desfecho", async () => {
    const { desfechos, tela } = montar();
    await esvaziar();
    act(() => tela().unmount());
    await avancar(30_000);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(desfechos).toEqual([]);
  });

  it("sessao vazia vira desfecho de erro, sem derrubar a tela", async () => {
    const { desfechos } = montar({ sessao: "  " });
    await esvaziar();

    expect(desfechos.map((d) => d.tipo)).toEqual(["erro"]);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("sessao ja cancelada ao abrir encerra como cancelado", async () => {
    respostas = [() => encerrada("canceled")];
    const { desfechos } = montar();
    await esvaziar();
    await avancar(30_000);

    expect(desfechos).toEqual([{ tipo: "cancelado" }]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
