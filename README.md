# Galeria de Fotos e Vídeos

Aplicação web para organizar fotos e vídeos em álbuns, separar mídias avulsas, marcar favoritos e localizar conteúdo por meio de uma busca global. O projeto foi desenvolvido como demonstração de desenvolvimento Full-Stack, utilizando Python e Flask no backend e HTML, CSS e JavaScript puro no frontend.

A aplicação utiliza SQLite para armazenar os dados dos usuários, álbuns e mídias, enquanto os arquivos enviados ficam no sistema de arquivos local.

## Funcionalidades

### Conta e autenticação

- Login por usuário e senha.
- Sessão baseada no mecanismo padrão de sessões do Flask.
- Logout e consulta da sessão autenticada.
- Mensagens genéricas para falhas de autenticação.
- Limitação de tentativas de login por endereço IP: até 5 tentativas dentro de uma janela de 60 segundos, mantidas em memória pelo processo.
- Três contas demonstrativas e seus álbuns iniciais, criados automaticamente na inicialização do banco de dados.

> O projeto não possui cadastro de novos usuários pela interface ou pela API apresentada.

### Álbuns

- Listagem dos álbuns pertencentes à conta autenticada.
- Exibição da quantidade de mídias e de uma foto de capa, quando disponível.
- Edição do nome, da descrição e da classificação como momento especial.
- Exclusão de álbuns. As mídias associadas ao álbum são mantidas e passam a ser mídias soltas.
- Acesso à lista de fotos e vídeos de cada álbum.

### Fotos e vídeos

- Upload de imagens JPG/JPEG, PNG, GIF e WEBP.
- Upload de vídeos MP4 e WEBM.
- Tamanho máximo de 50 MB por arquivo.
- Envio para um álbum ou para a área de fotos soltas.
- Barra de progresso durante o upload.
- Título opcional para a mídia.
- Edição do título, alteração do álbum associado e marcação de favorito.
- Substituição e exclusão de arquivos enviados.
- Visualização de imagens em lightbox, com zoom acionado pelo clique.
- Pré-visualização de vídeos no modal de edição.

### Organização e busca

- Área de momentos especiais, baseada na classificação dos álbuns.
- Área de fotos soltas, para mídias sem álbum associado.
- Área de favoritos.
- Busca global por nome e descrição de álbuns e por título de mídia.
- Priorização de resultados por correspondência exata, prefixo, palavra e trecho.

### Interface

- Tema escuro com cores inspiradas em coral, dourado e oceano.
- Mosaico de imagens com animação diagonal na tela de login.
- Layout responsivo: em telas menores, a navegação lateral é transformada em uma barra horizontal.
- Modais para upload e edição de álbuns e mídias.
- Estados visuais de carregamento, conteúdo vazio e erro.

As imagens do mosaico da tela de login são carregadas do serviço externo [Picsum Photos](https://picsum.photos). Portanto, esse elemento depende de conexão com a internet.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Backend | Python 3 e Flask |
| Banco de dados | SQLite 3 |
| Frontend | HTML5, CSS3 e JavaScript puro |
| Autenticação | Sessões Flask e `werkzeug.security` |
| Verificação de arquivos | `filetype` |
| Armazenamento de mídias | Sistema de arquivos local |

## Estrutura do projeto

```text
galeriadefotos/
├── app.py                  # Aplicação Flask, API, autenticação e acesso ao SQLite
├── requirements.txt        # Dependências Python
├── .gitignore              # Arquivos e diretórios que não devem ir para o Git
├── README.md               # Documentação do projeto
│
├── .secret_key              # Gerado automaticamente na primeira execução
├── users.db                 # Banco SQLite criado na inicialização
├── uploads/                 # Diretório de arquivos enviados
│
├── templates/
│   ├── index.html           # Página de login
│   └── galeria.html         # Interface principal da galeria
│
└── static/
    ├── styles.css           # Estilos da tela de login
    ├── app.js               # Mosaico e autenticação do frontend
    ├── galeria.css          # Estilos do painel, modais e lightbox
    └── galeria.js           # Navegação, busca, uploads e operações da galeria
```

Os arquivos `.secret_key`, `users.db` e o diretório `uploads/` são dados locais de execução. Eles não devem ser versionados nem enviados ao repositório.

## Requisitos

- Python 3.8 ou superior.
- Git.
- Navegador moderno com suporte a JavaScript.

## Instalação e execução local

### 1. Clone o repositório

```bash
git clone https://github.com/ArthurJython/galeriadefotos.git
cd galeriadefotos
```

### 2. Crie e ative um ambiente virtual

Linux e macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Windows (PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Instale as dependências

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

O arquivo `requirements.txt` contém:

```text
Flask==3.0.3
filetype==1.2.0
```

### 4. Inicie a aplicação

```bash
python app.py
```

Na inicialização direta por `python app.py`, a aplicação cria ou inicializa o banco de dados, insere as contas demonstrativas e seus álbuns iniciais quando necessário, cria o diretório `uploads/` e gera `.secret_key` caso ela ainda não exista.

### 5. Acesse no navegador

Abra:

```text
http://127.0.0.1:5000
```

## Contas demonstrativas

O banco de dados é inicializado com as seguintes contas de demonstração:

| Usuário | Senha |
|---|---|
| `alice` | `AliceSenhaForte!2026` |
| `bruno` | `BrunoSenhaForte!2026` |
| `carla` | `CarlaSenhaForte!2026` |

Cada conta possui seus próprios álbuns iniciais. As mídias enviadas ficam associadas ao usuário autenticado.

> **Importante:** essas credenciais são públicas e existem apenas para demonstração local. Não as utilize em uma instalação real. Remova ou substitua as contas e senhas demonstrativas antes de disponibilizar uma instância a outras pessoas.

## Endpoints da API

As rotas abaixo fazem parte da API implementada. As rotas de dados exigem uma sessão autenticada, exceto pelo endpoint de login.

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/api/auth/login` | Autentica o usuário e inicia a sessão. |
| `GET` | `/api/auth/me` | Retorna o usuário da sessão atual. |
| `POST` | `/api/logout` | Encerra a sessão. |
| `GET` | `/api/albums` | Lista os álbuns do usuário autenticado. |
| `PATCH` | `/api/albums/<album_id>` | Atualiza nome, descrição ou classificação especial de um álbum. |
| `DELETE` | `/api/albums/<album_id>` | Exclui um álbum e transforma suas mídias em mídias soltas. |
| `GET` | `/api/albums/<album_id>/medias` | Lista as mídias de um álbum. |
| `POST` | `/api/albums/<album_id>/upload` | Envia uma mídia para um álbum. |
| `GET` | `/api/medias/loose` | Lista as mídias sem álbum. |
| `POST` | `/api/medias/loose/upload` | Envia uma mídia sem associá-la a um álbum. |
| `GET` | `/api/medias/favorites` | Lista as mídias favoritas. |
| `PATCH` | `/api/medias/<media_id>` | Atualiza título, favorito ou álbum de uma mídia. |
| `DELETE` | `/api/medias/<media_id>` | Exclui uma mídia e tenta remover seu arquivo do disco. |
| `POST` | `/api/medias/<media_id>/replace` | Substitui o arquivo de uma mídia. |
| `GET` | `/api/media/<media_id>/raw` | Entrega o arquivo de mídia ao proprietário autenticado. |
| `GET` | `/api/search?q=<termo>` | Busca álbuns e mídias do usuário autenticado. |

## Armazenamento e segurança implementados

- **Hash de senhas:** as senhas são armazenadas por meio de `generate_password_hash` do Werkzeug; a autenticação usa `check_password_hash`.
- **Chave de sessão:** na primeira execução, uma chave aleatória é gerada e salva localmente em `.secret_key`. O arquivo é criado com permissão `0600` em sistemas compatíveis.
- **Cookies de sessão:** a configuração define `HttpOnly` e `SameSite=Lax`.
- **Isolamento por usuário:** álbuns e mídias possuem `user_id`. As consultas e operações verificam a propriedade dos recursos antes de permitir leitura ou alteração.
- **Verificação de uploads:** o backend identifica o tipo do arquivo a partir de sua assinatura, usando `filetype`, e aceita apenas os MIME types definidos na aplicação.
- **Nomes de arquivos:** os arquivos enviados são salvos com nomes baseados em UUID, em vez de utilizar diretamente o nome fornecido pelo usuário como caminho no disco.
- **Limite de tamanho:** o backend verifica o limite de 50 MB por arquivo e possui um tratamento para requisições que ultrapassam o tamanho máximo configurado.
- **Consultas SQL parametrizadas:** os valores fornecidos pelo usuário são passados como parâmetros nas consultas SQL.
- **Política de conteúdo:** as páginas HTML incluem políticas CSP declaradas por meio de meta tags.

### Limitações e cuidados para produção

Este repositório demonstra medidas de segurança, mas a implementação atual deve ser tratada como um projeto de portfólio e execução local, não como uma implantação de produção pronta.

Antes de publicar o serviço na internet:

1. Desative o modo de depuração. O arquivo atual inicia o Flask com `debug=True`; não use o servidor de desenvolvimento do Flask em produção.
2. Configure HTTPS e cookies de sessão com `Secure=True`. Essa flag não está configurada no código apresentado.
3. Remova as contas e credenciais demonstrativas e implemente um processo seguro de criação e administração de usuários.
4. Substitua o rate limiting em memória por uma solução adequada ao ambiente de implantação. O contador atual existe apenas no processo Python e é perdido quando ele reinicia; múltiplos processos não compartilham esse estado.
5. Implemente proteção CSRF apropriada para as operações que utilizam autenticação por cookie.
6. Aplique limites de upload e cooldown também no backend. O limite de 20 envios por sessão e o intervalo de 3 segundos estão implementados no JavaScript e podem ser contornados por chamadas diretas à API.
7. Revise logs, tratamento de erros, permissões de arquivos, política de backup e retenção das mídias.
8. Garanta que `.secret_key`, `users.db`, `uploads/`, ambientes virtuais e outros dados locais estejam no `.gitignore`.

Exemplo de entradas para o `.gitignore`:

```gitignore
.venv/
venv/
__pycache__/
*.py[cod]
.secret_key
users.db
uploads/
.env
```

## Decisões de implementação

- O backend e o frontend são servidos pela mesma aplicação Flask e pelo mesmo domínio.
- O SQLite mantém os registros de usuários, álbuns e mídias; os binários ficam em `uploads/`.
- Uma mídia sem álbum é representada por `album_id = NULL`.
- A exclusão de um álbum não apaga os arquivos associados: as mídias são desvinculadas e continuam disponíveis na área de fotos soltas.
- A busca é realizada no backend e classifica correspondências em memória usando uma pontuação simples de relevância.
- O frontend utiliza JavaScript puro, sem framework de interface.

## Autor

Desenvolvido por [ArthurJython](https://github.com/ArthurJython).

Repositório: [github.com/ArthurJython/galeriadefotos](https://github.com/ArthurJython/galeriadefotos)
