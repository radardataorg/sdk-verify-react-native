/**
 * O nucleo do SDK, sem React Native: `@radardata/verify-react-native/nucleo`.
 *
 * E TypeScript puro e roda em Node, o que serve para teste no backend de quem
 * integra e para orquestrar a sessao sem tela. O indice raiz exporta tambem o
 * componente, que importa `react-native`, e isso nao carrega fora do Metro.
 */
export { type ProvedorDeProvaDeVida, semProvedorNativo } from "../nativo/provedor.js";
export {
  BiometriaIndisponivel,
  ErroVerify,
  FalhaDeRede,
  PassoForaDeOrdem,
  SemCamera,
  SessaoInvalida,
} from "./erros.js";
export { Orquestrador } from "./orquestrador.js";
export { Runtime, tokenDaUrl, urlDaSessao } from "./runtime.js";
export { terminou } from "./tipos.js";
export type { Desfecho, EstadoSessao, Passo, TipoPasso } from "./tipos.js";
