import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CepAddressFields, type CepAddressValue } from "@/components/cep-address-fields";

export type ClientFormValue = CepAddressValue & {
  full_name: string;
  cpf: string;
  phone: string;
  email: string;
  birth_date: string;
  instagram: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string;
};

export const EMPTY_CLIENT_FORM: ClientFormValue = {
  full_name: "", cpf: "", phone: "", email: "", birth_date: "", instagram: "",
  zip_code: "", address: "", address_number: "", address_complement: "",
  neighborhood: "", city: "", state: "", notes: "",
  latitude: null, longitude: null, place_id: "",
};

/** Campos de cadastro de cliente compartilhados entre a criação e a edição. */
export function ClientFormFields({
  value,
  onChange,
}: {
  value: ClientFormValue;
  onChange: (patch: Partial<ClientFormValue>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Nome completo *</Label>
        <Input value={value.full_name} onChange={(e) => onChange({ full_name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>CPF</Label>
          <Input value={value.cpf} onChange={(e) => onChange({ cpf: e.target.value })} placeholder="opcional" />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>E-mail</Label>
          <Input value={value.email} onChange={(e) => onChange({ email: e.target.value })} />
        </div>
        <div>
          <Label>Data de nascimento</Label>
          <Input type="date" value={value.birth_date} onChange={(e) => onChange({ birth_date: e.target.value })} />
        </div>
      </div>
      <div>
        <Label>Instagram</Label>
        <Input value={value.instagram} onChange={(e) => onChange({ instagram: e.target.value })} placeholder="@usuario" />
      </div>

      <div className="border-t pt-3">
        <CepAddressFields
          value={value}
          onChange={(patch) => onChange({ ...patch, latitude: null, longitude: null, place_id: "" })}
        />
      </div>
      {value.latitude != null && value.longitude != null && (
        <p className="text-xs text-muted-foreground">📍 Localização salva: {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}</p>
      )}

      <div>
        <Label>Observações</Label>
        <Textarea
          rows={3}
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Preferências, tamanho, o que costuma comprar…"
        />
      </div>
    </div>
  );
}
