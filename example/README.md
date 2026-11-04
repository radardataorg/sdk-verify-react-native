# Exemplo do RadarData Verify para React Native

App mínimo que roda o `@radardata/verify-react-native` e serve para duas coisas:
testar o pacote em aparelho de verdade e mostrar como integrar. São três peças,
as mesmas que uma integração real tem:

| Peça | O que faz |
|---|---|
| [`backend/servidor.mjs`](backend/servidor.mjs) | Guarda o token de API, cria a sessão com o `@radardata/sdk` e confirma o resultado |
| [`seuBackend.ts`](seuBackend.ts) | O que o app pede ao backend. Nenhum segredo passa por aqui |
| [`App.tsx`](App.tsx), componente `Verificacao` | Entrega a URL ao `VerifyRadarData` e recebe o desfecho |

## Testar com uma sessão de verdade

Com o aparelho no cabo:

```bash
cd backend
cp .env.example .env     # coloque em RADARDATA_TOKEN um token de API da empresa
npm install
npm start                # aponta o aparelho para a máquina e sobe em http://localhost:8799
```

Ao subir, o backend avisa se o RadarData aceitou o token. O token precisa do
escopo `verify`, além de `leitura` para essa conferência.

No app, na aba **Pelo backend**, informe o alias ou o id do fluxo e toque em
**Criar sessão e iniciar**. Se o fluxo exigir algum dado de entrada, como o CPF, o
campo aparece na tela quando o servidor o pedir. No final, o app mostra o desfecho
e o que o backend confirmou.

**Criar sessão pode gerar cobrança**, conforme o preço do fluxo. Cancelar e voltar
não apaga a sessão: a URL dela fica na aba **Colar URL**, para reabrir sem criar
outra.

Para testar sem backend, gere o link no painel em **Verify, Sessões, Gerar link**
e cole na aba **Colar URL**.

## Gerar o APK

Precisa de Node 22.13 ou mais novo, JDK 17 e do SDK Android com a plataforma 37,
build-tools 37.0.0 e NDK 27.1.12297006.

```bash
nvm use 22
npm --prefix .. install   # só na primeira vez
npm --prefix .. run build
npm install

export JAVA_HOME=/caminho/do/jdk-17
export ANDROID_HOME=$HOME/Android/Sdk
(cd android && ./gradlew assembleRelease)
cp android/app/build/outputs/apk/release/app-release.apk RadarDataVerifyExemplo.apk
```

O APK sai assinado com a chave de debug do template, com o JavaScript embutido e
com as ABIs `arm64-v8a` e `armeabi-v7a`. Serve para instalar e testar, não para
publicar em loja. Para rodar em emulador x86_64, acrescente
`-PreactNativeArchitectures=x86_64` ao comando do Gradle.

## De onde vem o SDK

O `package.json` aponta para `file:..`, e o `.npmrc` usa `install-links=true`:
o npm copia o pacote em vez de criar um link. O resultado tem só o que está em
`files`, igual ao que sai do npm, e por isso o teste vale pelo que o cliente
recebe.

Depois de mudar algo em `../src`, atualize a cópia:

```bash
npm run sdk
```

## Apontar para a máquina de desenvolvimento

O campo **Base da API** troca o servidor que o componente consulta. Em produção o
app só fala HTTPS; o HTTP sem TLS fica liberado apenas para `localhost`,
`127.0.0.1` e `10.0.2.2` (`res/xml/network_security_config.xml`).

No aparelho físico, `localhost` é o próprio aparelho. Para ele alcançar a sua
máquina pelo cabo:

```bash
adb reverse tcp:<porta> tcp:<porta>
```
