import { module as fans } from "../route.ts";
import { product as ductSystems } from "@pe/duct-systems-contract/product";
import { admitModules } from "@pe/ducts-web/admission.test-support";
import { contractOwner } from "@pe/ducts-web/work-owner.test-support";
export const admit = (version = "fans-fixture") =>
  admitModules(contractOwner(ductSystems.work, fans.data.directory), fans, version);
