export type OlistStockUpdate = {
  externalId: string;
  quantity: number;
};

/** Read-only Olist catalog transport. Never imports the ERP synchronization writer. */
export function createOlistAuditClient(
  token: string,
  transport: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  if (!token) throw new Error("Credencial Olist indisponível.");
  async function read(endpoint: string, params: Record<string, string>) {
    // Fixed destinations; neither URL nor token can be supplied by an HTTP caller.
    await pause(2200);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await transport(`https://api.tiny.com.br/api2/${endpoint}`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, formato: "JSON", ...params }),
        });
      } catch { throw new Error("Falha de conexão na leitura Olist."); }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await pause(10000 * (attempt + 1)); continue;
      }
      if (!response.ok) throw new Error(`Leitura Olist HTTP ${response.status}.`);
      let result: any;
      try { result = (await response.json()).retorno; }
      catch { throw new Error("Resposta Olist inválida."); }
      if (result?.status !== "OK") {
        const throttled = (result?.erros ?? []).some((e: any) => /API Bloqueada|Excedido o número de acessos/i.test(String(e.erro)));
        if (throttled && attempt < 2) { await pause(10000 * (attempt + 1)); continue; }
        // Do not echo upstream errors: they can include credentials or request data.
        throw new Error("Olist recusou a consulta; nenhuma alteração realizada.");
      }
      return result;
    }
    throw new Error("Limite Olist atingido; consulta interrompida.");
  }
  return {
    async listPage(page: number) {
      if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error("Página inválida.");
      const r = await read("produtos.pesquisa.php", { pagina: String(page), pesquisa: "" });
      if (Number(r.pagina) !== page || !Number.isInteger(Number(r.numero_paginas)) || Number(r.numero_paginas) < page || !Array.isArray(r.produtos)) {
        throw new Error("Paginação Olist incompleta.");
      }
      const products = r.produtos.map((p: any) => p.produto);
      if (products.some((p: any) => !p || !/^\d+$/.test(String(p.id)))) throw new Error("Produto Olist sem identificador.");
      return { page, totalPages: Number(r.numero_paginas), products };
    },
    async product(id: string) {
      if (!/^\d{1,20}$/.test(id)) throw new Error("Identificador Olist inválido.");
      const r = await read("produto.obter.php", { id });
      if (!r.produto || String(r.produto.id) !== id) throw new Error("Produto Olist divergente da consulta.");
      return r.produto;
    },
    async stockUpdates(since: string): Promise<OlistStockUpdate[]> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("Data inicial Olist inválida.");
      const [year, month, day] = since.split("-");
      const r = await read("lista.atualizacoes.estoque.php", {
        dataAlteracao: `${day}/${month}/${year}`,
      });
      if (r.empty) return [];
      const products = Array.isArray(r.produtos)
        ? r.produtos.map((item: any) => item?.produto ?? item)
        : [];
      if (
        products.some(
          (item: any) =>
            !item ||
            !/^\d{1,20}$/.test(String(item.id ?? "")) ||
            !Number.isFinite(Number(item.saldo)),
        )
      ) {
        throw new Error("Atualizações de estoque Olist incompletas.");
      }
      return products.map((item: any) => ({
        externalId: String(item.id),
        quantity: Math.max(0, Number(item.saldo)),
      }));
    },
  };
}
