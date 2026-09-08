-- Quinto furo: ao editar um produto e remover um tamanho da grade, o
-- formulário só marca a variação como deleted_at (soft delete) sem checar
-- se ela ainda tem estoque físico. A peça continua existindo em
-- inventory_balances, some das buscas (PDV, recebimento, edição do
-- produto — todas filtram deleted_at is null) mas ainda aparece em
-- Estoque/Movimentações: estoque "preso", sem dono, sem como vender nem
-- dar entrada nele por onde deveria.
--
-- Trigger no banco (não só checagem no frontend) porque é o mesmo padrão
-- já usado no resto do projeto: a tabela é a fonte da verdade, não uma
-- tela específica — se amanhã outro fluxo também tentar soft-deletar uma
-- variação, o bloqueio vale igual.

CREATE OR REPLACE FUNCTION public._prevent_variant_delete_with_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_qty numeric;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT COALESCE(SUM(physical_quantity), 0) INTO v_qty
      FROM public.inventory_balances
     WHERE variant_id = NEW.id;
    IF v_qty > 0 THEN
      RAISE EXCEPTION
        'Não é possível remover esta variação: ainda há % peça(s) em estoque. Zere o saldo (ajuste/inventário) antes de remover.',
        v_qty;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_variant_delete_with_stock ON public.product_variants;
CREATE TRIGGER trg_prevent_variant_delete_with_stock
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public._prevent_variant_delete_with_stock();

REVOKE ALL ON FUNCTION public._prevent_variant_delete_with_stock() FROM PUBLIC, anon, authenticated;
