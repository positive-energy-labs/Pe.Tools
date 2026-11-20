import { checkoutRootFrom } from "@pe/host-contracts/service-identity";

const root = checkoutRootFrom(import.meta.dirname);
if (!root) throw new Error(`apps/web is not inside a Pe.Tools checkout (${import.meta.dirname}).`);

export const checkoutRoot = root;
