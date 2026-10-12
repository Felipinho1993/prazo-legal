# Prazo Legal

Aplicação jurídica em JavaScript para controlar prazos processuais, audiências e reuniões. Esta versão usa um backend próprio em Node.js, PostgreSQL e sessões seguras — não depende do Supabase.

## O que está incluído

- Cadastro, login, logout e recuperação de senha
- Senhas protegidas com Argon2id
- Sessões em cookies `HttpOnly`, armazenadas no PostgreSQL
- Limitação de tentativas de login e validação de origem
- Isolamento dos compromissos por usuário no servidor
- Painel, agenda mensal, busca e filtros
- Prazos, audiências e reuniões com lembretes
- Exportação `.ics`, relatório CSV e backup JSON
- Interface responsiva e PWA
- Docker Compose para subir aplicação e banco
- Workflow que publica somente a interface no GitHub Pages

## Arquitetura

```text
Navegador
   │ HTTPS
   ▼
Node.js / Express ─── PostgreSQL
   │
   └── public/ (HTML, CSS e JavaScript)
```

Para dados reais, a opção recomendada é publicar interface e API no mesmo domínio. Isso mantém os cookies como primeira parte e reduz problemas de privacidade entre navegadores.

O GitHub pode continuar hospedando o código-fonte. O GitHub Pages é opcional e publica somente a pasta `public/`; ele não substitui o servidor Node.js.

## Início rápido com Docker

Requisitos: Docker e Docker Compose.

1. Copie `.env.example` para `.env`.
2. Gere um segredo de sessão:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

3. Preencha no `.env`, no mínimo:

```dotenv
POSTGRES_PASSWORD=uma-senha-longa-e-exclusiva
SESSION_SECRET=resultado-do-comando-acima
PUBLIC_APP_URL=http://localhost:3000
APP_ORIGINS=http://localhost:3000
```

4. Suba os serviços:

```bash
docker compose up -d --build
```

5. Acesse `http://localhost:3000` e crie a primeira conta.

As migrações do banco são executadas automaticamente. O volume `prazo_legal_db` preserva os dados entre reinicializações.

## Rodar Node.js e PostgreSQL separadamente

Requisitos: Node.js 20 ou superior e PostgreSQL 14 ou superior.

```bash
npm install
npm run db:migrate
npm start
```

O servidor usa a porta `3000` por padrão. Consulte `.env.example` para configurar a conexão com o banco, cookies, cadastro e SMTP.

## Recuperação de senha

Configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` no `.env`. Sem SMTP, o login e o cadastro funcionam, mas nenhum e-mail de recuperação é enviado.

Os links de recuperação:

- usam tokens aleatórios de uso único;
- guardam somente o hash do token no banco;
- expiram em 30 minutos;
- invalidam as sessões anteriores após a troca de senha.

## Publicação recomendada

Publique o container em um servidor com:

- domínio próprio e HTTPS;
- PostgreSQL com backups automáticos;
- volume persistente;
- variáveis do `.env` configuradas no painel do provedor;
- `COOKIE_SECURE=true`;
- `PUBLIC_APP_URL=https://agenda.seu-dominio.com.br`;
- `APP_ORIGINS=https://agenda.seu-dominio.com.br`.

Não envie o arquivo `.env` ao GitHub. Ele já está no `.gitignore`.

## Usar GitHub Pages com API separada

Essa opção funciona, mas exige cuidado extra com cookies entre domínios. Prefira um domínio próprio, por exemplo:

```text
app.seu-dominio.com.br  → GitHub Pages
api.seu-dominio.com.br  → servidor Node.js
```

Em `public/config.js`, configure:

```js
window.PRAZO_LEGAL_CONFIG = {
  mode: "api",
  apiBaseUrl: "https://api.seu-dominio.com.br",
  workspaceName: "Nome do escritório",
  allowDemoMode: false,
};
```

No backend:

```dotenv
PUBLIC_APP_URL=https://app.seu-dominio.com.br
APP_ORIGINS=https://app.seu-dominio.com.br
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
```

Se frontend e API estiverem em sites completamente diferentes, pode ser necessário `COOKIE_SAME_SITE=none`. Alguns navegadores bloqueiam cookies de terceiros; por isso o mesmo domínio principal ou uma publicação única é mais confiável.

O workflow `.github/workflows/pages.yml` publica automaticamente o conteúdo de `public/` quando houver um push na branch `main`. Ative **GitHub Actions** como fonte em **Settings > Pages**.

## Comandos

```bash
npm run dev         # servidor com reinício automático
npm run db:migrate  # executa migrações pendentes
npm test            # testes de validação e segurança
npm run check       # sintaxe + testes
npm start           # produção
```

## Estrutura do repositório

```text
prazo-legal/
├── .github/workflows/pages.yml
├── migrations/001_initial.sql
├── public/
│   ├── assets/favicon.svg
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── config.js
│   ├── service-worker.js
│   └── manifest.webmanifest
├── server/
│   ├── auth.js
│   ├── config.js
│   ├── db.js
│   ├── events.js
│   ├── index.js
│   ├── mailer.js
│   ├── middleware.js
│   ├── migrate.js
│   └── security.js
├── test/security.test.js
├── .env.example
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Antes de usar em produção

- Configure HTTPS; não publique autenticação por HTTP.
- Use senhas exclusivas para banco, sessão e SMTP.
- Restrinja o PostgreSQL para aceitar apenas conexões da aplicação.
- Ative backups testados e monitore o espaço do banco.
- Defina `ALLOW_SIGNUP=false` caso somente o escritório possa criar contas.
- Não inclua processos reais no modo demonstrativo ou em screenshots públicas.
- Faça uma avaliação profissional de segurança e privacidade antes de armazenar dados sigilosos de clientes.

Este projeto fornece uma base técnica segura, mas a segurança final também depende da hospedagem, dos controles de acesso, dos backups e da operação do escritório.
