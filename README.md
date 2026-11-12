# GestaoMona

Painel interno de confecção para acompanhar produtos, preços, produção, estoque e vendas externas. O frontend usa Vite, o login usa Firebase Authentication e a API Node.js usa o Firebase Admin SDK com Cloud Firestore.

## Rodar localmente

Requisitos: Node.js 24 e npm. Execute `npm ci`, copie `.env.example` para `.env.local`, preencha as variáveis e execute `npm run dev`. Abra o endereço exibido pelo Vite. O servidor de desenvolvimento inclui a API em `/api/gestao`.

### Firebase

1. No projeto `gestaomona-60d33`, habilite o provedor **E-mail/senha** em Authentication e crie o banco Cloud Firestore.
2. Publique as regras com `npx firebase-tools deploy --only firestore --project gestaomona-60d33`. As regras bloqueiam o acesso direto a todas as coleções. A API verifica o token e consulta o perfil antes de operar. As consultas atuais usam índices simples automáticos.
3. Em Configurações do projeto → Contas de serviço, gere uma chave de serviço em uma conta com acesso ao Authentication e ao Firestore. Preencha `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` apenas no ambiente de execução. Para rodar o script administrativo, use `GOOGLE_APPLICATION_CREDENTIALS` apontando para o JSON fora do repositório.
4. No Authentication, crie o usuário inicial de e-mail/senha. Execute `node scripts/bootstrap.js email@empresa.com` com as credenciais de ambiente configuradas. Depois, adicione colaboradores pelo menu **Usuários**. O formulário pode enviar o link de definição de senha ao e-mail da conta.
5. Autorize os domínios necessários em Authentication → Configurações → Domínios autorizados. Inclua `localhost` para desenvolvimento e o domínio de produção da Vercel.

Contas precisam de um perfil ativo provisionado para acessar a API. Um administrador não pode desativar nem rebaixar a própria conta. Custos e totais financeiros das operações são filtrados na API para colaboradores.

### Emuladores

Em um terminal, execute `npx firebase-tools emulators:start --only auth,firestore --project gestaomona-60d33`. O emulador Firestore exige Java. No projeto, configure `.env.local` com:

```env
FIREBASE_PROJECT_ID=gestaomona-60d33
VITE_USE_EMULATORS=true
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Crie o primeiro usuário em Authentication na interface dos emuladores. Exporte as mesmas variáveis de emulador para o terminal que executará `node scripts/bootstrap.js email@empresa.com`. Execute `npm run dev`. Para popular a demonstração, exporte as variáveis dos dois emuladores no terminal e execute `npm run demo`. O comando cria dois usuários de teste e imprime os dados de acesso. As vendas de exemplo abrangem o ano anterior e o ano atual.

### Imagens

Cadastre a URL HTTPS direta da imagem, que deve ser retornada pelo provedor como arquivo de imagem. A tela exibe prévia e fallback. O Firestore guarda a URL. Um link público permite que qualquer pessoa que o tenha acesse a imagem. Links de compartilhamento que retornem uma página HTML, como links comuns do Google Drive, não servem como URL direta. Use um endereço de imagem do seu provedor externo e confira a prévia no cadastro.

## Operações e relatórios

- O estoque é calculado por SKU. O saldo e o lançamento são gravados em uma única transação, que valida disponibilidade e trata concorrência.
- A venda registra preço, desconto por unidade e custo histórico em centavos. A devolução usa os valores da venda original e reduz a quantidade elegível em uma transação. O retorno físico é opcional. A tela permite preencher toda a quantidade elegível para estorno total.
- A chave de idempotência é armazenada na sessão do navegador enquanto o resultado de uma operação está pendente. A API aceita a repetição da mesma operação com a mesma chave, sem duplicar a movimentação.
- Relatórios usam a data comercial informada em `America/Fortaleza`. Devoluções entram no mês da própria operação. As margens exibidas somam as linhas com custo cadastrado. As consultas de histórico leem 50 documentos por página. A API de relatórios lê o intervalo filtrado em páginas de 250 documentos e calcula os totais no servidor.
- As operações preservam o SKU e os dados de catálogo registrados na época. Arquive produtos e variações para mantê-los consultáveis no histórico.

## Verificação e publicação

Execute `npm run lint`, `npm run typecheck` (módulo de regras de negócio), `npm test` e `npm run build`. Com os dois emuladores ativos e as variáveis `FIREBASE_AUTH_EMULATOR_HOST` e `FIRESTORE_EMULATOR_HOST` exportadas para o terminal, `npm test` também executa a integração da API. O teste cria contas e registros descartáveis nos emuladores.

No GitHub, envie os arquivos para `Tallysson2k23/GestaoMona`. Na Vercel, importe o repositório, selecione o preset **Vite** e configure as três variáveis de serviço do Firebase para o ambiente. O comando é `npm run build` e a saída é `dist`. A função é descoberta no diretório `api`. Não configure variáveis dos emuladores na Vercel. Adicione o domínio da Vercel aos domínios autorizados do Firebase e verifique login, lote, venda e devolução com dados de teste.

