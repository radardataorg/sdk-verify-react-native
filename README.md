# RadarData Verify para React Native

Coloca o [RadarData Verify](https://radardata.com.br) dentro do seu app: prova
de vida, documento e coleta de dados, sem o usuário sair da sua aplicação.

```bash
npm i @radardata/verify-react-native react-native-webview
```

## Leia isto antes: o que é nativo hoje

Nesta versão **todos os passos rodam em WebView**, inclusive a prova de vida:

| Passo | Como roda |
|---|---|
| Prova de vida | **WebView** (a mesma página testada em produção) |
| Documento | **WebView** |
| Consentimento, campos, sócio, apontamentos | **WebView** |

O fluxo **funciona de ponta a ponta** em iOS e Android, porque o WebView
carrega o fluxo de verdade e pede a câmera.

O caminho nativo está **preparado, não pronto**: existe o contrato
`ProvedorDeProvaDeVida`, e o servidor já devolve o desafio no
`POST /liveness/start`. Quando a implementação nativa existir, você passa um
`provedorDeProvaDeVida` e o passo sai do WebView **sem mudar mais nada no seu
código**.

## Uso

```tsx
import { VerifyRadarData } from "@radardata/verify-react-native";

function MinhaVerificacao({ urlDaSessao }: { urlDaSessao: string }) {
  return (
    <VerifyRadarData
      sessao={urlDaSessao}
      onDesfecho={(d) => {
        if (d.tipo === "concluido") {
          console.log(d.estado.resultado); // APROVADO | REPROVADO | REVISAO_MANUAL
          console.log(d.estado.motivo);    // por que não aprovou, em texto neutro
        }
        if (d.tipo === "erro") console.warn(d.erro.message);
      }}
    />
  );
}
```

## O app não cria a sessão, e isso é de propósito

A sessão é criada pelo **seu backend**, com o
[`@radardata/sdk`](https://www.npmjs.com/package/@radardata/sdk) ou o
[`radardata/sdk-php`](https://packagist.org/packages/radardata/sdk-php), e o
app recebe só a url (ou o token) dela.

Criar a sessão do app exigiria o **token de API da empresa** dentro do
aparelho, e token de API em aparelho de usuário final é token vazado: com ele
dá para gastar o saldo da sua conta. O `VerifyRadarData` aceita tanto a url
quanto o token, porque quem integra guarda o que recebeu e passa adiante.

```ts
// No SEU backend
const sessao = await radar.verify.criarSessao("kyc-cnpj", { cnpj }, { reference_id: pedidoId });
return { url: sessao.url };   // isto é o que o app recebe
```

## Permissão de câmera

O WebView precisa da câmera, e o componente já concede a permissão que a página
pede. Falta o que só o app pode declarar:

**iOS**, no `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Para confirmar que é você, com uma selfie.</string>
```

**Android**, no `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Sem isso o sistema nega a câmera sem dizer por que, e o sintoma aparece como se
o fluxo estivesse quebrado.

## Como o componente sabe que terminou

Ele **pergunta ao servidor**, em intervalo, em vez de espiar a navegação do
WebView. Depender da url de redirecionamento ou de mensagem da página amarraria
o pacote ao HTML do runtime, que muda sem aviso; o **estado da sessão é
contrato**.

Falha de rede no meio do caminho não encerra nada: a pessoa pode estar sem
sinal, e a rodada seguinte tenta de novo. Ajuste com
`intervaloDeConferenciaMs` se precisar.

## Erros

| Classe | Quando, e o que fazer |
|---|---|
| `SessaoInvalida` | expirou, foi cancelada ou nunca existiu. **Não** tente de novo: peça uma sessão nova ao seu backend |
| `PassoForaDeOrdem` | o passo pedido não é o atual da sessão |
| `BiometriaIndisponivel` | biometria fora do ar do nosso lado |
| `FalhaDeRede` | sem resposta: timeout, DNS, sem sinal |
| `ErroVerify` | raiz de todas, com `.codigo`, `.status` e `.corpo` |

## Quem decide a aprovação

O **servidor**. O nativo roda o desafio e o `POST /liveness/result` busca o
resultado e avalia. Um SDK que decidisse no aparelho estaria deixando o usuário
final aprovar a si mesmo.

## Para quem for escrever a ponte nativa

```ts
import type { ProvedorDeProvaDeVida } from "@radardata/verify-react-native";

export const meuProvedor: ProvedorDeProvaDeVida = {
  async disponivel() {
    return Platform.OS === "ios" || Platform.OS === "android";
  },
  async executar(desafio) {
    // `desafio` é o corpo cru de POST /liveness/start: { session_id, ... }.
    await MeuModuloNativo.rodarProvaDeVida(desafio.session_id);
    // Não devolva veredito: quem avalia é o servidor.
  },
};
```

O `Orquestrador` pergunta `disponivel()` antes de usar, e não só o tipo do
passo: aparelho sem câmera, ou permissão negada, cai no WebView em vez de
travar.

## Desenvolvimento

```bash
npm install
npm test          # testa a orquestração, que é onde vive a regra
npm run typecheck
npm run build
```

Os testes cobrem a decisão (o que é nativo, o que é WebView, em que ordem a
prova de vida acontece) e não o componente de tela, que precisa de React Native
em execução.

## Licença

MIT.
