-- Distingue vendas entregues imediatamente no balcão de retiradas futuras.
-- A preferência registrada evita que a venda apareça como pendência de expedição.
ALTER TYPE public.delivery_method ADD VALUE IF NOT EXISTS 'in_store' BEFORE 'pickup';
