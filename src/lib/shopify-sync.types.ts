export type ImmediateShopifySyncResult = {
  ok: boolean;
  queued: boolean;
  synced: boolean;
  disabled: boolean;
  requested: number;
  productIds: string[];
  errors: string[];
};

export type ProductShopifySyncResult = ImmediateShopifySyncResult & {
  error?: string;
};
