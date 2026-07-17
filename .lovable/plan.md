## O que vai mudar

### 1. Cadastro de cliente no PDV (dois modos)

No mesmo modal "Cliente" (F8) do PDV:

- **Cadastro rápido** (padrão, como hoje): nome, CPF, telefone, e‑mail. Sem quebrar o fluxo do caixa.
- Botão discreto **"Cadastro completo"** abre um modal maior com, além dos campos acima:
  - CEP (com busca automática via ViaCEP ao completar 8 dígitos)
  - Logradouro, número, complemento
  - Bairro, cidade, UF
  - Data de nascimento (opcional)
  - Observações (opcional)
- Ao salvar em qualquer um dos modos, o cliente já entra selecionado na venda em andamento.
- Máscaras em CPF, telefone e CEP; validação de CPF continua ativa quando preenchido.

### 2. CPF obrigatório — configurável

- Nova configuração da organização: **"Exigir CPF no cadastro de clientes pelo PDV"** (padrão: desligado).
- Local: **Configurações → PDV / Caixa** (nova seção, ou aba dentro de Configurações).
- Quando ligada:
  - Rápido e completo dentro do PDV exigem CPF válido antes de salvar.
  - Se o cliente for selecionado a partir da busca (já existente sem CPF), o PDV mostra aviso e pede para completar o CPF antes de finalizar a venda.
- Na tela **Clientes → Novo/Editar** o CPF permanece opcional (não trava importações nem clientes antigos), independentemente da configuração.

### 3. Onde a config é lida

- Server function pública ao carregar o PDV traz a flag da organização.
- Cache com React Query, invalidada quando a configuração é alterada.

## Detalhes técnicos

- **Banco:** adicionar coluna `pdv_require_cpf boolean not null default false` em `organizations` via migration (com GRANTs/RLS já existentes na tabela).
- **UI PDV** (`src/routes/_authenticated/pdv.tsx`):
  - Refatorar o bloco "Cadastro rápido" para receber estado estendido (endereço).
  - Novo `ClientFullForm` (colapsável ou dialog separado acionado por botão "Cadastro completo").
  - Helpers de máscara reutilizando `normalizeDigits` / `validCPF` de `@/lib/pos`.
  - Fetch ViaCEP client-side (`https://viacep.com.br/ws/{cep}/json/`), com fallback silencioso em caso de erro.
- **Insert em `clients`:** incluir os novos campos de endereço (colunas já existentes na tabela) apenas quando preenchidos.
- **Configurações:** nova rota/aba `configuracoes.pdv.tsx` com o toggle; server fn para ler/gravar a flag (via `requireSupabaseAuth` + verificação de papel admin, mesmo padrão das outras configurações).
- **Validação:** se `pdv_require_cpf` estiver ligado, bloquear finalização da venda quando `clientId` selecionado não tiver CPF, mostrando toast com CTA para editar.

## O que NÃO muda

- Layout base do PDV, atalhos de teclado, RLS existentes.
- Tela de Clientes e demais fluxos (trocas, expedição, etc.).
- Comportamento do "Consumidor Final" (venda sem cliente segue permitida quando a config estiver desligada).
