-- Raio-X 2, achado grave: a permissão 'settings.manage' nunca existiu na
-- tabela permissions. As telas Configurações > Tamanhos e Configurações >
-- Importar dados (RequirePermission code="settings.manage"), e as regras
-- de RLS de org_size_presets e org_color_aliases, checam essa permissão —
-- como o código nunca existiu, has_permission('settings.manage') sempre
-- retorna falso pra qualquer usuário, sempre. Essas duas telas e essas
-- duas tabelas eram inacessíveis pra TODO MUNDO, inclusive o
-- Administrador, desde que foram criadas.
--
-- Cria a permissão e concede a Administrador e Gerente — mesmo par de
-- cargos que já tem category.manage/brand.manage/supplier.manage, os
-- outros ajustes de "cadastro auxiliar da loja".

INSERT INTO public.permissions (code, name, module)
VALUES ('settings.manage', 'Gerenciar configurações da loja', 'configuracoes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'settings.manage'
  AND r.name IN ('Administrador', 'Gerente')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;
