export type ViaCepAddress = {
  zipCode: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
};

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

export function normalizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function formatCep(value: string) {
  const digits = normalizeCep(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export async function lookupBrazilianCep(
  value: string,
  signal?: AbortSignal,
): Promise<ViaCepAddress> {
  const digits = normalizeCep(value);
  if (digits.length !== 8) throw new Error("Informe os 8 números do CEP.");

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal });
  if (!response.ok) throw new Error("O ViaCEP não respondeu. Tente novamente.");

  const data = (await response.json()) as ViaCepResponse;
  if (data.erro) throw new Error("CEP não encontrado.");

  return {
    zipCode: formatCep(data.cep ?? digits),
    address: data.logradouro?.trim() ?? "",
    neighborhood: data.bairro?.trim() ?? "",
    city: data.localidade?.trim() ?? "",
    state: data.uf?.trim().toUpperCase() ?? "",
  };
}
