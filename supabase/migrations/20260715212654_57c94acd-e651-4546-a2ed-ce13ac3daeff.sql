
CREATE POLICY "product_images_select_org" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "product_images_insert_org" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "product_images_update_org" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "product_images_delete_org" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.current_org_id()::text);
