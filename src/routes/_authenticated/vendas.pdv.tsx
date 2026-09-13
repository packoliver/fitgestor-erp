import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * PDV antigo — aposentado.
 *
 * Este arquivo já tinha 3.024 linhas de um PDV completo que NUNCA rodava: o
 * `beforeLoad` abaixo sempre redirecionava para /pdv antes de o componente
 * montar. Era o PDV original, substituído pelo de /pdv (que traz o comentário
 * "Portado de vendas.pdv.tsx" na troca rápida). Ficou como código morto, com
 * busca e chaves de cache próprias divergindo em paralelo.
 *
 * A rota continua existindo só para não quebrar link ou favorito antigo.
 * O PDV oficial e único é `src/routes/_authenticated/pdv.tsx` (/pdv).
 */
export const Route = createFileRoute("/_authenticated/vendas/pdv")({
  beforeLoad: () => {
    throw redirect({ to: "/pdv", replace: true });
  },
});
