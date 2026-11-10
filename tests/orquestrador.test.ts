import { describe, expect, it, vi } from "vitest";
import type { ProvedorDeProvaDeVida } from "../src/nativo/provedor.js";
import { PassoForaDeOrdem, SessaoInvalida } from "../src/nucleo/erros.js";
import { Orquestrador } from "../src/nucleo/orquestrador.js";
import { Runtime, tokenDaUrl, urlDaSessao } from "../src/nucleo/runtime.js";
import { terminou } from "../src/nucleo/tipos.js";

/**
 * O que se testa aqui e a DECISAO: o que roda nativo, o que cai no WebView, e
 * em que ordem a prova de vida acontece. O componente de tela precisa de React
 * Native para rodar, e nao e ele que carrega a regra.
 */

const json = (corpo: unknown, status = 200) => () =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function runtimeFalso(respostas: Array<() => Response | Error>) {
  const chamadas: Array<{ url: string; metodo: string }> = [];
  let i = 0;

  const runtime = new Runtime("tok-da-sessao", {
    base: "https://api.exemplo/api",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), metodo: init?.method ?? "GET" });
      const r = respostas[Math.min(i++, respostas.length - 1)]!();
      if (r instanceof Error) throw r;
      return r;
    }) as typeof globalThis.fetch,
  });

  return { runtime, chamadas };
}

const bootstrap = (etapa: string | null, status = "in_progress", passos: unknown[] = []) => ({
  session_id: "sess-1",
  status,
  etapa_atual: etapa,
  outcome: null,
  motivo: null,
  steps: passos,
  branding: {},
});

const nativoPronto = (): ProvedorDeProvaDeVida => ({
  disponivel: vi.fn().mockResolvedValue(true),
  executar: vi.fn().mockResolvedValue(undefined),
});

const nativoAusente = (): ProvedorDeProvaDeVida => ({
  disponivel: vi.fn().mockResolvedValue(false),
  executar: vi.fn(),
});

describe("token da sessao", () => {
  it("aceita url e token, porque quem integra guarda o que recebeu", () => {
    expect(tokenDaUrl("https://verify.cliente.com/s/abc123")).toBe("abc123");
    expect(tokenDaUrl("https://verify.cliente.com/s/abc123?x=1")).toBe("abc123");
    expect(tokenDaUrl("abc123")).toBe("abc123");
  });

  it("sessao vazia nao deixa o runtime ser construido", () => {
    expect(() => new Runtime("")).toThrow(/token da sessão/i);
  });
});

describe("o que roda nativo", () => {
  it("prova de vida vai para o nativo quando ha provedor", async () => {
    const { runtime } = runtimeFalso([json(bootstrap("liveness", "in_progress", [{ tipo: "liveness" }]))]);
    const o = new Orquestrador(runtime, nativoPronto());

    expect(await o.rodaNativo(await o.estado())).toBe(true);
  });

  it("sem provedor, a prova de vida cai no WebView em vez de travar", async () => {
    const { runtime } = runtimeFalso([json(bootstrap("liveness", "in_progress", [{ tipo: "liveness" }]))]);
    const o = new Orquestrador(runtime, nativoAusente());

    // Aparelho sem camera, ou permissao negada, tem de seguir pelo WebView.
    expect(await o.rodaNativo(await o.estado())).toBe(false);
  });

  it("coleta de dados NAO vai para o nativo, e isso e o pedido", async () => {
    for (const tipo of ["consent", "fields", "socio_check", "apontamentos", "document"]) {
      const { runtime } = runtimeFalso([json(bootstrap(tipo, "in_progress", [{ tipo }]))]);
      const o = new Orquestrador(runtime, nativoPronto());

      expect(await o.rodaNativo(await o.estado()), `${tipo} deveria ir para o WebView`).toBe(false);
    }
  });

  it("sessao que ja acabou nao roda passo nenhum", async () => {
    const { runtime } = runtimeFalso([json(bootstrap(null, "completed", [{ tipo: "liveness" }]))]);
    const o = new Orquestrador(runtime, nativoPronto());
    const estado = await o.estado();

    expect(terminou(estado)).toBe(true);
    expect(await o.rodaNativo(estado)).toBe(false);
  });
});

describe("prova de vida nativa", () => {
  it("servidor cria, nativo roda, SERVIDOR avalia", async () => {
    const { runtime, chamadas } = runtimeFalso([
      json({ session_id: "des-1", regiao: "a" }),
      json(bootstrap(null, "completed")),
    ]);
    const provedor = nativoPronto();
    const o = new Orquestrador(runtime, provedor);

    const estado = await o.provaDeVidaNativa();

    // A ordem importa: quem avalia e o servidor. Provedor que decidisse aqui
    // deixaria o aparelho do usuario final aprovar a si mesmo.
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://api.exemplo/api/verify/rt/tok-da-sessao/liveness/start",
      "https://api.exemplo/api/verify/rt/tok-da-sessao/liveness/result",
    ]);
    expect(provedor.executar).toHaveBeenCalledWith({ session_id: "des-1", regiao: "a" });
    expect(estado.status).toBe("completed");
  });

  it("o provedor nativo recebe exatamente o que o servidor devolveu", async () => {
    const { runtime } = runtimeFalso([
      json({ session_id: "des-2", desafio: "movimento" }),
      json(bootstrap(null, "completed")),
    ]);
    const provedor = nativoPronto();

    await new Orquestrador(runtime, provedor).provaDeVidaNativa();

    // Sem traduzir nem filtrar: o contrato e entre o servidor e a
    // implementacao nativa, e o SDK no meio nao deve ter opiniao sobre os campos.
    expect(provedor.executar).toHaveBeenCalledWith({ session_id: "des-2", desafio: "movimento" });
  });
});

describe("conferir se a sessao acabou", () => {
  const conferir = (r: () => Response | Error) => {
    const { runtime } = runtimeFalso([r]);
    return new Orquestrador(runtime, nativoAusente()).conferir();
  };

  it("em andamento, informa o estado e nao encerra", async () => {
    const { estado, desfecho } = await conferir(json(bootstrap("document")));

    expect(estado?.etapaAtual).toBe("document");
    expect(desfecho).toBeNull();
  });

  it("concluida, entrega o desfecho", async () => {
    const { desfecho } = await conferir(json(bootstrap(null, "completed")));

    expect(desfecho?.tipo).toBe("concluido");
  });

  const encerrada = (status?: string) =>
    json({ error: { code: "sessao_encerrada", message: "acabou", ...(status ? { status } : {}) } }, 410);

  it("expirada no meio do fluxo encerra com erro, em vez de consultar para sempre", async () => {
    for (const r of [encerrada("expired"), encerrada()]) {
      const { desfecho } = await conferir(r);

      expect(desfecho?.tipo).toBe("erro");
      expect(desfecho?.tipo === "erro" && desfecho.erro).toBeInstanceOf(SessaoInvalida);
    }
  });

  it("cancelada pelo backend de quem integra encerra como cancelado, nao como erro", async () => {
    const { desfecho } = await conferir(encerrada("canceled"));

    expect(desfecho).toEqual({ tipo: "cancelado" });
  });

  it("sessao inexistente continua erro, mesmo com status no corpo", async () => {
    const { desfecho } = await conferir(json({ error: { message: "nao achei", status: "canceled" } }, 404));

    expect(desfecho?.tipo).toBe("erro");
  });

  it("estado cancelado vira cancelado; expirado com 200 encerra como concluido", async () => {
    expect((await conferir(json(bootstrap(null, "canceled")))).desfecho).toEqual({ tipo: "cancelado" });
    expect((await conferir(json(bootstrap(null, "expired")))).desfecho?.tipo).toBe("concluido");
  });

  it("falha de rede e erro do servidor nao encerram: a proxima rodada tenta de novo", async () => {
    for (const r of [() => new Error("sem sinal"), json({}, 500), json({}, 429)]) {
      expect(await conferir(r)).toEqual({ estado: null, desfecho: null });
    }
  });
});

describe("pagina do fluxo", () => {
  it("url vale como veio, para nao perder o dominio proprio do cliente", () => {
    expect(urlDaSessao(" https://kyc.cliente.com/s/abc123 ")).toBe("https://kyc.cliente.com/s/abc123");
  });

  it("token sozinho abre no dominio padrao, em vez de carregar para sempre", () => {
    expect(urlDaSessao("abc123")).toBe("https://verify.radardata.com.br/s/abc123");
  });
});

describe("erros do runtime", () => {
  it("sessao expirada ou cancelada vira SessaoInvalida", async () => {
    for (const status of [401, 404, 410]) {
      const { runtime } = runtimeFalso([json({ error: { code: "x", message: "acabou" } }, status)]);

      // A acao do app aqui nao e tentar de novo: e pedir uma sessao nova ao
      // proprio backend.
      await expect(runtime.bootstrap()).rejects.toBeInstanceOf(SessaoInvalida);
    }
  });

  it("passo fora de ordem tem classe propria", async () => {
    const { runtime } = runtimeFalso([json({ error: { code: "y", message: "fora de ordem" } }, 409)]);

    await expect(runtime.livenessStart()).rejects.toBeInstanceOf(PassoForaDeOrdem);
  });
});

describe("0.1.3", () => {
  it("sessao failed termina, em vez de conferir para sempre", async () => {
    const { runtime } = runtimeFalso([json({ ...bootstrap(null, "failed"), outcome: "REPROVADO", motivo: "Tentativas esgotadas" })]);
    const o = new Orquestrador(runtime, { disponivel: async () => false, executar: async () => undefined });

    const { desfecho } = await o.conferir();
    expect(desfecho?.tipo).toBe("concluido");
    expect(terminou({ ...bootstrap(null, "failed"), status: "failed" } as never)).toBe(true);
  });

  it("prova de vida nativa devolve o session_id do desafio", async () => {
    const corpos: unknown[] = [];
    const runtime = new Runtime("tok", {
      base: "https://api.exemplo/api",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        corpos.push(init?.body ? JSON.parse(String(init.body)) : null);
        return String(url).endsWith("/liveness/start")
          ? new Response(JSON.stringify({ session_id: "liv-9" }), { status: 200 })
          : new Response(JSON.stringify(bootstrap("consent")), { status: 200 });
      }) as typeof globalThis.fetch,
    });
    const o = new Orquestrador(runtime, { disponivel: async () => true, executar: async () => undefined });

    await o.provaDeVidaNativa();
    expect(corpos.at(-1)).toEqual({ session_id: "liv-9" });
  });
});
