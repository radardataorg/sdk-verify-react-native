import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  type Desfecho,
  ErroVerify,
  SessaoInvalida,
  VerifyRadarData,
} from "@radardata/verify-react-native";
import { confirmarSessao, criarSessao, ErroDoBackend, type SessaoConfirmada } from "./seuBackend";

const ROXO = "#7C3AED";
const ROXO_CLARO = "#EFE9FF";
const TINTA = "#11151F";
const APAGADO = "#5F6675";
const BORDA = "#DDDFE5";
const VERDE = "#008F62";
const VERMELHO = "#C4314B";
const AMBAR = "#A86400";

interface Evento {
  readonly hora: string;
  readonly texto: string;
}

interface Formulario {
  readonly modo: "backend" | "url";
  readonly backend: string;
  readonly fluxo: string;
  /** Os dados que o fluxo pediu, conforme o servidor vai dizendo quais. */
  readonly input: Readonly<Record<string, string>>;
  readonly sessao: string;
  readonly base: string;
}

interface Execucao {
  readonly sessao: string;
  readonly base: string;
  /** De onde veio a sessao: null quando a url foi colada. */
  readonly origem: { readonly backend: string; readonly id: string } | null;
}

type Tela =
  | { readonly nome: "inicio" }
  | { readonly nome: "verificando"; readonly execucao: Execucao }
  | {
      readonly nome: "resultado";
      readonly execucao: Execucao;
      readonly desfecho: Desfecho;
      readonly eventos: readonly Evento[];
    };

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <Exemplo />
    </SafeAreaProvider>
  );
}

function Exemplo() {
  const [form, setForm] = useState<Formulario>({
    modo: "backend",
    backend: "http://localhost:8799",
    fluxo: "",
    input: {},
    sessao: "",
    base: "",
  });
  const [tela, setTela] = useState<Tela>({ nome: "inicio" });

  const mudar = useCallback((parte: Partial<Formulario>) => setForm((atual) => ({ ...atual, ...parte })), []);
  const voltar = useCallback(() => setTela({ nome: "inicio" }), []);

  // O botao voltar do Android sai da verificacao em vez de fechar o app. A
  // sessao continua valida no servidor e pode ser reaberta com a mesma url.
  useEffect(() => {
    if (tela.nome === "inicio") return;

    const assinatura = BackHandler.addEventListener("hardwareBackPress", () => {
      voltar();
      return true;
    });
    return () => assinatura.remove();
  }, [tela.nome, voltar]);

  if (tela.nome === "verificando") {
    return (
      <Verificacao
        execucao={tela.execucao}
        onTerminar={(desfecho, eventos) =>
          setTela({ nome: "resultado", execucao: tela.execucao, desfecho, eventos })
        }
        onCancelar={voltar}
      />
    );
  }

  if (tela.nome === "resultado") {
    return <Resultado execucao={tela.execucao} desfecho={tela.desfecho} eventos={tela.eventos} onNova={voltar} />;
  }

  return <Inicio form={form} mudar={mudar} onIniciar={(execucao) => setTela({ nome: "verificando", execucao })} />;
}

function Inicio(props: {
  form: Formulario;
  mudar: (parte: Partial<Formulario>) => void;
  onIniciar: (execucao: Execucao) => void;
}) {
  const { form, mudar, onIniciar } = props;
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [faltando, setFaltando] = useState<Readonly<Record<string, string>>>({});

  const pelaUrl = form.modo === "url";
  const pronto = pelaUrl ? form.sessao.trim() !== "" : form.backend.trim() !== "" && form.fluxo.trim() !== "";

  async function iniciar() {
    setErro(null);
    setFaltando({});

    if (pelaUrl) {
      onIniciar({ sessao: form.sessao.trim(), base: form.base.trim(), origem: null });
      return;
    }

    const backend = form.backend.trim();
    setCriando(true);
    try {
      const criada = await criarSessao(backend, form.fluxo.trim(), preenchidos(form.input));
      // Fica em "Colar URL": sair e voltar nao precisa criar outra sessao.
      mudar({ sessao: criada.url });
      onIniciar({ sessao: criada.url, base: form.base.trim(), origem: { backend, id: criada.id } });
    } catch (e) {
      const campos = e instanceof ErroDoBackend ? e.campos : {};
      // Quem sabe o que o fluxo exige e o servidor: o campo aparece quando ele pede.
      if (Object.keys(campos).length > 0) {
        const vazios = Object.fromEntries(Object.keys(campos).map((chave) => [chave, ""]));
        mudar({ input: { ...vazios, ...form.input } });
        setFaltando(campos);
      }
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCriando(false);
    }
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <Image source={require("./assets/logo.png")} style={estilos.logo} resizeMode="contain" />
        <Text style={estilos.titulo}>Verify no seu app</Text>
        <Text style={estilos.texto}>
          Exemplo do pacote @radardata/verify-react-native: a verificação acontece dentro do app, e o app recebe o
          desfecho no final.
        </Text>

        <View style={estilos.bloco}>
          <Text style={estilos.subtitulo}>Como funciona</Text>
          <Passo numero="1" texto="O seu backend cria a sessão com o token de API. O token nunca vem para o app." />
          <Passo numero="2" texto="O app recebe a URL da sessão e entrega ao componente VerifyRadarData." />
          <Passo numero="3" texto="O componente conduz o fluxo e pergunta ao servidor quando terminou." />
          <Passo numero="4" texto="O seu backend confere o resultado antes de liberar qualquer coisa." />
        </View>

        <View style={estilos.abas}>
          <Aba rotulo="Pelo backend" ativa={!pelaUrl} onPress={() => mudar({ modo: "backend" })} id="aba-backend" />
          <Aba rotulo="Colar URL" ativa={pelaUrl} onPress={() => mudar({ modo: "url" })} id="aba-url" />
        </View>

        {pelaUrl ? (
          <>
            <Campo
              rotulo="URL da sessão"
              valor={form.sessao}
              aoMudar={(sessao) => mudar({ sessao })}
              exemplo="https://verify.radardata.com.br/s/..."
              ajuda="Gere o link no painel: Verify, Sessões, Gerar link."
              id="campo-sessao"
            />
          </>
        ) : (
          <>
            <Campo
              rotulo="Backend"
              valor={form.backend}
              aoMudar={(backend) => mudar({ backend })}
              exemplo="http://localhost:8799"
              ajuda="O backend de exemplo, na sua máquina, pelo cabo."
              id="campo-backend"
            />
            <Campo
              rotulo="Fluxo"
              valor={form.fluxo}
              aoMudar={(fluxo) => mudar({ fluxo })}
              exemplo="kyc-cliente"
              ajuda="O alias ou o id do fluxo, como aparece no painel."
              id="campo-fluxo"
            />
            {Object.keys(form.input).map((chave) => (
              <Campo
                key={chave}
                rotulo={chave}
                valor={form.input[chave] ?? ""}
                aoMudar={(valor) => mudar({ input: { ...form.input, [chave]: valor } })}
                ajuda={faltando[chave]}
                id={`campo-input-${chave}`}
              />
            ))}
          </>
        )}

        <Campo
          rotulo="Base da API (opcional)"
          valor={form.base}
          aoMudar={(base) => mudar({ base })}
          exemplo="https://api.radardata.com.br/api"
          ajuda="Deixe vazio para usar produção."
          id="campo-base"
        />

        {erro ? (
          <Text style={estilos.erro} testID="erro-inicio">
            {erro}
          </Text>
        ) : null}

        <Pressable
          style={[estilos.botao, (!pronto || criando) && estilos.botaoDesligado]}
          disabled={!pronto || criando}
          onPress={iniciar}
          testID="botao-iniciar"
        >
          {criando ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={estilos.botaoTexto}>{pelaUrl ? "Iniciar verificação" : "Criar sessão e iniciar"}</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Aba(props: { rotulo: string; ativa: boolean; onPress: () => void; id: string }) {
  return (
    <Pressable style={[estilos.aba, props.ativa && estilos.abaAtiva]} onPress={props.onPress} testID={props.id}>
      <Text style={[estilos.abaTexto, props.ativa && estilos.abaTextoAtiva]}>{props.rotulo}</Text>
    </Pressable>
  );
}

function Campo(props: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  exemplo?: string;
  ajuda?: string;
  id: string;
}) {
  return (
    <>
      <Text style={estilos.rotulo}>{props.rotulo}</Text>
      <TextInput
        style={estilos.campo}
        value={props.valor}
        onChangeText={props.aoMudar}
        placeholder={props.exemplo}
        placeholderTextColor={APAGADO}
        autoCapitalize="none"
        autoCorrect={false}
        testID={props.id}
      />
      {props.ajuda ? <Text style={estilos.ajuda}>{props.ajuda}</Text> : null}
    </>
  );
}

function Passo({ numero, texto }: { numero: string; texto: string }) {
  return (
    <View style={estilos.passo}>
      <Text style={estilos.passoNumero}>{numero}</Text>
      <Text style={estilos.passoTexto}>{texto}</Text>
    </View>
  );
}

function Verificacao(props: {
  execucao: Execucao;
  onTerminar: (desfecho: Desfecho, eventos: readonly Evento[]) => void;
  onCancelar: () => void;
}) {
  const { execucao, onTerminar } = props;
  const eventos = useRef<Evento[]>([]);
  const [estadoAtual, setEstadoAtual] = useState("abrindo a sessão");

  return (
    <SafeAreaView style={estilos.tela}>
      <View style={estilos.barra}>
        <Pressable onPress={props.onCancelar} hitSlop={12} testID="botao-cancelar">
          <Text style={estilos.barraBotao}>Cancelar</Text>
        </Pressable>
        <Text style={estilos.barraEstado} numberOfLines={1} testID="estado-atual">
          {estadoAtual}
        </Text>
      </View>
      <VerifyRadarData
        sessao={execucao.sessao}
        base={execucao.base || undefined}
        onDesfecho={(desfecho) => onTerminar(desfecho, eventos.current)}
        onEstado={(estado) => {
          const texto = `${estado.status} / ${estado.etapaAtual ?? "sem etapa"}`;
          if (eventos.current[eventos.current.length - 1]?.texto !== texto) {
            eventos.current.push({ hora: horaAgora(), texto });
          }
          setEstadoAtual(texto);
        }}
      />
    </SafeAreaView>
  );
}

function Resultado(props: {
  execucao: Execucao;
  desfecho: Desfecho;
  eventos: readonly Evento[];
  onNova: () => void;
}) {
  const { execucao, desfecho, eventos } = props;
  const resumo = resumoDoDesfecho(desfecho);

  return (
    <SafeAreaView style={estilos.tela}>
      <ScrollView contentContainerStyle={estilos.conteudo}>
        <Text style={estilos.subtitulo}>Desfecho entregue ao app</Text>
        <Text style={[estilos.resultado, { color: resumo.cor }]} testID="resultado">
          {resumo.titulo}
        </Text>
        {resumo.detalhe ? <Text style={estilos.texto}>{resumo.detalhe}</Text> : null}

        {execucao.origem ? <ConfirmacaoDoBackend backend={execucao.origem.backend} id={execucao.origem.id} /> : null}

        {eventos.length > 0 ? (
          <View style={estilos.bloco}>
            <Text style={estilos.subtitulo}>Linha do tempo (status / etapa)</Text>
            {eventos.map((evento, i) => (
              <Text key={`${evento.hora}-${i}`} style={estilos.evento}>
                {evento.hora}  {evento.texto}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={estilos.bloco}>
          <Text style={estilos.subtitulo}>O que o componente devolveu</Text>
          <Text style={estilos.codigo} selectable>
            {detalheCru(desfecho)}
          </Text>
        </View>

        <Pressable style={estilos.botao} onPress={props.onNova} testID="botao-nova">
          <Text style={estilos.botaoTexto}>Nova verificação</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ConfirmacaoDoBackend({ backend, id }: { backend: string; id: string }) {
  const [confirmada, setConfirmada] = useState<SessaoConfirmada | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    confirmarSessao(backend, id)
      .then((c) => vivo && setConfirmada(c))
      .catch((e: Error) => vivo && setErro(e.message));

    return () => {
      vivo = false;
    };
  }, [backend, id]);

  return (
    <View style={estilos.bloco}>
      <Text style={estilos.subtitulo}>O que o backend confirmou</Text>
      <Text style={estilos.evento} testID="confirmacao">
        {erro ?? (confirmada ? `${confirmada.status} / ${confirmada.resultado ?? "sem resultado"}` : "conferindo")}
      </Text>
      <Text style={estilos.ajuda}>
        É daqui que se decide liberar algo. A tela serve para a pessoa, e quem controla o aparelho controla o que o app
        vê.
      </Text>
    </View>
  );
}

function preenchidos(input: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([chave, valor]) => [chave, valor.trim()])
      .filter(([, valor]) => valor !== ""),
  );
}

function resumoDoDesfecho(desfecho: Desfecho): { titulo: string; detalhe: string | null; cor: string } {
  // O backend cancelou a sessao pela API. Nao e falha: ninguem precisa tentar de novo.
  if (desfecho.tipo === "cancelado") return { titulo: "Sessão cancelada", detalhe: null, cor: AMBAR };

  if (desfecho.tipo === "erro") {
    // SessaoInvalida pede outra acao: nao adianta repetir, o backend precisa
    // criar uma sessao nova. Por isso ela tem classe propria.
    const titulo = desfecho.erro instanceof SessaoInvalida ? "Sessão encerrada" : "Erro";
    return { titulo, detalhe: desfecho.erro.message, cor: VERMELHO };
  }

  const { resultado, status, motivo } = desfecho.estado;
  if (resultado === "APROVADO") return { titulo: "Aprovado", detalhe: motivo, cor: VERDE };
  if (resultado === "REPROVADO") return { titulo: "Reprovado", detalhe: motivo, cor: VERMELHO };
  if (resultado === "REVISAO_MANUAL") return { titulo: "Em revisão manual", detalhe: motivo, cor: AMBAR };

  // Terminou sem resultado. Na pratica o servidor responde 410 a sessao expirada,
  // e ela chega como erro; isto cobre o estado que vier com 200.
  return { titulo: status === "expired" ? "Sessão expirada" : "Sessão encerrada", detalhe: motivo, cor: AMBAR };
}

function detalheCru(desfecho: Desfecho): string {
  if (desfecho.tipo === "concluido") return JSON.stringify(desfecho.estado.cru, null, 2);
  if (desfecho.tipo === "cancelado") return JSON.stringify(desfecho, null, 2);

  const { erro } = desfecho;
  return JSON.stringify(
    {
      classe: erro.name,
      mensagem: erro.message,
      ...(erro instanceof ErroVerify ? { codigo: erro.codigo, status: erro.status } : {}),
    },
    null,
    2,
  );
}

function horaAgora(): string {
  return new Date().toTimeString().slice(0, 8);
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: "#FFFFFF" },
  conteudo: { padding: 20, paddingBottom: 40, gap: 8 },
  logo: { width: 170, height: 56, marginBottom: 8 },
  titulo: { fontSize: 26, fontWeight: "700", color: TINTA },
  subtitulo: { fontSize: 13, fontWeight: "700", color: APAGADO, textTransform: "uppercase", letterSpacing: 0.5 },
  texto: { fontSize: 15, lineHeight: 22, color: TINTA },
  bloco: { backgroundColor: "#F6F6F9", borderRadius: 12, padding: 14, gap: 10, marginVertical: 8 },
  passo: { flexDirection: "row", gap: 10 },
  passoNumero: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 22,
    fontSize: 12,
    fontWeight: "700",
    color: ROXO,
    backgroundColor: ROXO_CLARO,
  },
  passoTexto: { flex: 1, fontSize: 14, lineHeight: 20, color: TINTA },
  abas: { flexDirection: "row", gap: 4, backgroundColor: "#F6F6F9", borderRadius: 10, padding: 4 },
  aba: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 7 },
  abaAtiva: { backgroundColor: "#FFFFFF" },
  abaTexto: { fontSize: 14, fontWeight: "600", color: APAGADO },
  abaTextoAtiva: { color: ROXO },
  rotulo: { fontSize: 14, fontWeight: "600", color: TINTA, marginTop: 8 },
  campo: {
    borderWidth: 1,
    borderColor: BORDA,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TINTA,
  },
  ajuda: { fontSize: 13, lineHeight: 18, color: APAGADO },
  erro: { fontSize: 14, lineHeight: 20, color: VERMELHO, marginTop: 8 },
  botao: { backgroundColor: ROXO, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  botaoDesligado: { opacity: 0.4 },
  botaoTexto: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  barra: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDA,
  },
  barraBotao: { color: ROXO, fontSize: 15, fontWeight: "600" },
  barraEstado: { flex: 1, textAlign: "right", color: APAGADO, fontSize: 13 },
  resultado: { fontSize: 32, fontWeight: "700", marginVertical: 4 },
  evento: { fontSize: 13, color: TINTA, fontFamily: "monospace" },
  codigo: { fontSize: 12, lineHeight: 17, color: TINTA, fontFamily: "monospace" },
});
