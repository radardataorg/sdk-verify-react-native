import { createServer } from "node:http";
import { ErroRadarData, RadarData } from "@radardata/sdk";

/**
 * O SEU backend, no tamanho minimo: o unico lugar que conhece o token de API.
 *
 * O app pede a sessao aqui e recebe so a url dela. Token de API em aparelho de
 * usuario final e token vazado, e com ele da para gastar o saldo da empresa.
 *
 * Num backend de verdade falta o que este exemplo nao precisa, porque so escuta
 * a propria maquina: autenticar quem pede. Cada sessao criada pode gerar cobranca.
 */
const radar = new RadarData({
  token: process.env.RADARDATA_TOKEN,
  ...(process.env.RADARDATA_BASE ? { base: process.env.RADARDATA_BASE } : {}),
});

const PORTA = Number(process.env.PORTA ?? 8799);

async function criarSessao({ fluxo, input }) {
  // O reference_id liga a sessao ao que ela confirma no SEU sistema, e e como
  // voce a encontra depois. Criar sessao nao e idempotente: nao repita as cegas.
  const sessao = await radar.verify.criarSessao(fluxo, input ?? {}, { reference_id: `exemplo-${Date.now()}` });

  return { id: sessao.id, url: sessao.url };
}

// E aqui que se decide liberar algo, e nao no app: o que chega ao aparelho
// serve para a tela, e quem controla o aparelho controla o que o app ve.
async function confirmarSessao(id) {
  const sessao = await radar.verify.sessao(id);

  return { status: sessao.status, resultado: sessao.resultado };
}

function lerCorpo(pedido) {
  return new Promise((resolver, rejeitar) => {
    let cru = "";
    pedido.on("data", (parte) => {
      cru += parte;
      if (cru.length > 64_000) rejeitar(new Error("Corpo grande demais."));
    });
    pedido.on("end", () => {
      try {
        resolver(cru === "" ? {} : JSON.parse(cru));
      } catch {
        rejeitar(new Error("O corpo não é um JSON válido."));
      }
    });
    pedido.on("error", rejeitar);
  });
}

/** Os dados que faltam, por campo: `input.cpf` vira `cpf`. */
function camposDoErro(erro) {
  const campos = {};
  for (const [chave, mensagens] of Object.entries(erro.corpo?.errors ?? {})) {
    if (chave.startsWith("input.")) campos[chave.slice("input.".length)] = [mensagens].flat()[0];
  }
  return campos;
}

function responder(resposta, status, corpo) {
  resposta.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  resposta.end(JSON.stringify(corpo));
}

const servidor = createServer(async (pedido, resposta) => {
  const { pathname } = new URL(pedido.url, "http://localhost");
  const sessaoNaRota = pathname.match(/^\/sessoes\/([^/]+)$/);

  try {
    if (pedido.method === "POST" && pathname === "/sessoes") {
      const criada = await criarSessao(await lerCorpo(pedido));
      console.log(`sessao criada: ${criada.id}`);
      return responder(resposta, 201, criada);
    }

    if (pedido.method === "GET" && sessaoNaRota) {
      return responder(resposta, 200, await confirmarSessao(decodeURIComponent(sessaoNaRota[1])));
    }

    return responder(resposta, 404, { erro: { mensagem: "Rota não encontrada." } });
  } catch (erro) {
    if (erro instanceof ErroRadarData) {
      console.warn(`recusado (${erro.status ?? "sem resposta"}): ${erro.message}`);
      return responder(resposta, erro.status ?? 502, {
        erro: { mensagem: erro.message, codigo: erro.codigo, campos: camposDoErro(erro) },
      });
    }

    return responder(resposta, 400, { erro: { mensagem: erro.message } });
  }
});

servidor.listen(PORTA, "127.0.0.1", async () => {
  console.log(`Backend de exemplo em http://localhost:${PORTA}`);

  // Confere o token ao subir, para o erro aparecer aqui e nao no meio do teste.
  try {
    await radar.catalogo.saldo();
    console.log("Token de API aceito pelo RadarData.");
  } catch (erro) {
    console.error(`O RadarData recusou o token: ${erro.message}`);
  }
});
