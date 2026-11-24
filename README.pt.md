# Serviço de Taxas de Câmbio

[English](README.md) · [Português](README.pt.md)

API HTTP em NestJS e TypeScript que converte moedas fiduciárias, criptomoedas e moedas personalizadas com cotações armazenadas no Redis. Cada cotação representa o valor em USD de uma unidade da moeda. O serviço consulta primeiro a CoinAPI e usa a CoinMarketCap para símbolos cuja cotação não encontra na CoinAPI.

## Execução local

Copie [`.env.example`](.env.example) para `.env` e configure suas próprias credenciais administrativas e seu segredo de assinatura. Informe as chaves das APIs se quiser usar cotações reais.

| Variável | Finalidade |
| --- | --- |
| `PORT` | Porta HTTP da aplicação. O exemplo e o mapeamento do Compose usam `3100`. Se alterar a variável no Compose, ajuste também a porta do contêiner no mapeamento. |
| `COINS` | Símbolos separados por vírgula para cadastro inicial. O exemplo cadastra `USD,BRL,EUR,BTC,ETH`. Use os símbolos com a mesma grafia, incluindo maiúsculas e minúsculas, e mantenha `USD` como moeda-base. |
| `DEMO_MODE` | Use `true` para ativar as cotações fixas de demonstração. O padrão é `false`. |
| `COINAPIKEY` | Chave da CoinAPI para consultar cotações em USD. |
| `MCAPIKEY` | Chave da CoinMarketCap para consultar o mapa de símbolos e as cotações em USD. |
| `REDIS` | URL do Redis. Use `redis://redis:6379` com o Redis do Compose ou `redis://127.0.0.1:6379` com o Redis e a aplicação na mesma máquina. |
| `LOGIN`, `PASS` | Credenciais do único administrador. |
| `SECRET` | Segredo de assinatura do JWT. |

Com Docker e Compose instalados, execute:

```sh
docker compose up --build
```

O Compose mantém o Redis na rede interna e espera que ele responda antes de iniciar a API. Para desenvolver sem Compose, use uma instância do Redis acessível a partir do host.

Para desenvolver sem Docker, instale Node.js 20.11 ou superior e npm, inicie um servidor Redis acessível pela URL em `REDIS` e execute:

```sh
npm ci
npm run start:dev
```

`npm run start:dev` usa a CLI do Nest com recarga automática. Em produção, execute `npm run build` e depois `npm run start:prod`. Execute `npm test` para compilar e verificar os endpoints HTTP e a atualização agendada com armazenamento em memória e respostas simuladas dos provedores. Os exemplos abaixo usam um shell compatível com POSIX e `http://localhost:3100`.

No modo normal, o serviço cadastra as moedas configuradas e tenta obter as primeiras cotações antes de aceitar requisições. Depois, atualiza as cotações a cada minuto. Se a primeira atualização falhar, as moedas recém-cadastradas mantêm a cotação provisória de 1. As limitações conhecidas estão em [ISSUES.md](ISSUES.md).

### Modo de demonstração

Defina `DEMO_MODE=true` no arquivo `.env` e reinicie a aplicação. Com o Compose, recrie o contêiner da aplicação para aplicar a nova configuração. O modo de demonstração usa cotações ilustrativas de 1 USD, 0,20 USD por BRL, 1,10 USD por EUR, 60.000 USD por BTC e 3.000 USD por ETH. Essas cinco moedas são cadastradas independentemente de `COINS`. Por exemplo, a conversão de 10 USD para BRL retorna 50 BRL.

O modo de demonstração dispensa consultas aos provedores e a coleta de dados de páginas. Você pode cadastrar outras moedas como `fixed` com uma cotação positiva. O Redis continua sendo necessário e armazena as moedas de demonstração separadamente das moedas do modo normal. Defina `DEMO_MODE=false` e reinicie a aplicação para voltar às cotações reais.

## CI/CD no GitHub Actions

Pull requests para `main` executam `npm ci` e `npm test`, compilam a imagem Docker e verificam uma conversão em modo de demonstração com Redis. Pushes em `main` executam as mesmas verificações e publicam a imagem testada no GitHub Container Registry com a tag do SHA completo do commit.

A publicação usa o `GITHUB_TOKEN` do próprio workflow. Para executar uma imagem publicada, substitua `<commit-sha>` pelo SHA da versão e defina `REDIS` no `.env` com uma URL acessível pelo contêiner. Para baixar uma imagem privada, autentique-se em `ghcr.io` com um token de acesso pessoal clássico com o escopo `read:packages` e acesso de leitura ao pacote. [Documentação do GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)

```sh
docker run --rm --env-file .env -p 3100:3100 ghcr.io/vangsscf/exchange-rate-service:<commit-sha>
```

### Revisão de PRs com OpenRouter

Em **Settings → Secrets and variables → Actions**, crie o secret `OPENROUTER_API_KEY`. A variável `OPENROUTER_MODEL` é opcional. O modelo padrão é `openai/gpt-5.4-mini`, que é cobrado pela OpenRouter. [Modelo e preços](https://openrouter.ai/openai/gpt-5.4-mini)

O workflow revisa PRs prontos para revisão, abertos no próprio repositório e direcionados a `main`. O job falha se o secret do repositório estiver ausente e é ignorado em forks e rascunhos. A cada atualização elegível, o workflow envia até 60.000 bytes de JSON com patches textuais completos e metadados dos arquivos. O parecer em inglês lista os arquivos incluídos e omitidos em **Actions → PR review with OpenRouter → Summary**.

## Converter moedas

`GET /conversion` é público.

| Parâmetro de consulta | Descrição |
| --- | --- |
| `from` | Símbolo da moeda de origem. Obrigatório. |
| `to` | Símbolo da moeda de destino. Obrigatório. |
| `amount` | Quantidade numérica opcional. O padrão é 1. |
| `decimalPlaces` | Inteiro opcional. Use de 1 a 30 para formatar o resultado. O padrão é 8, e a implementação atual também usa 8 quando recebe 0. |

```sh
curl 'http://localhost:3100/conversion?from=USD&to=EUR&amount=10&decimalPlaces=2'
```

Exemplo de resposta `200 OK`. O resultado depende das cotações armazenadas.

```json
{"from":"USD","amount":10,"to":"EUR","value":"9.20"}
```

Um símbolo desconhecido resulta em `404`. O campo formatado `value` é uma string JSON.

## Autenticar e renovar o token

`POST /login` recebe um corpo JSON com as strings obrigatórias `login` e `password`, que devem corresponder a `LOGIN` e `PASS`.

```sh
curl 'http://localhost:3100/login' \
  -H 'Content-Type: application/json' \
  --data '{"login":"YOUR_LOGIN","password":"YOUR_PASSWORD"}'
```

A resposta de sucesso é `200 OK` com `{"token":"<JWT>"}`. O token expira em duas horas. Envie o JWT no cabeçalho `Authorization: Bearer <JWT>`. Substitua `YOUR_JWT` nos exemplos pelo token recebido no login.

`GET /refresh` exige um token válido e ainda não expirado e devolve um novo token assinado no mesmo formato de resposta.

```sh
curl 'http://localhost:3100/refresh' -H 'Authorization: Bearer YOUR_JWT'
```

## Adicionar uma moeda

`POST /add` exige autenticação e um corpo JSON. A tentativa de adicionar um símbolo já armazenado com o tipo `main` retorna `404`.

| Campo | Descrição |
| --- | --- |
| `symbol` | String alfanumérica obrigatória de até 15 caracteres. As consultas diferenciam maiúsculas de minúsculas. |
| `type` | Obrigatório. Aceita `fiat`, `crypto`, `fixed` ou `scrapper`. |
| `rate` | Para `fixed`, informe uma cotação numérica positiva em USD por unidade. |
| `scrpprUrl` | URL da página, obrigatória para a coleta de dados. |
| `scrpprRateTag` | Seletor CSS do texto do preço, obrigatório para a coleta de dados. |
| `scrpprAmountTag` | Seletor CSS opcional do texto da quantidade. A quantidade padrão é 1. |
| `scrpprRateAsset` | Símbolo opcional da moeda do preço, já cadastrado no Redis. O padrão é USD. |
| `scrpprDecimalSymbol` | Separador decimal opcional, `,` ou `.`. O padrão é `,`. |

No modo normal, todos os tipos verificam primeiro as cotações carregadas da CoinAPI e depois o mapa de símbolos da CoinMarketCap antes de usar uma cotação fixa ou coletar dados de uma página. A coleta espera encontrar um trecho de texto com `$` em cada seletor configurado. O serviço busca uma cotação antes de salvar o registro. Alguns valores de entrada ainda podem gerar cotações inválidas.

```sh
curl 'http://localhost:3100/add' \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  --data '{"symbol":"DEMOCOIN","type":"fixed","rate":2.5}'
```

Exemplo de resposta `200 OK`:

```json
{"message":"Asset DEMOCOIN added with success!"}
```

## Remover uma moeda

`DELETE /remove/:asset` exige autenticação. A remoção de um símbolo desconhecido retorna `404`. Uma moeda atualmente armazenada com o tipo `main` retorna `400`.

```sh
curl -X DELETE 'http://localhost:3100/remove/DEMOCOIN' \
  -H 'Authorization: Bearer YOUR_JWT'
```

Exemplo de resposta `200 OK`:

```json
{"message":"Asset DEMOCOIN removed with success!"}
```
